from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only, selectinload

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user
from app.models import Order, Shipment, TrackingEvent, User
from app.schemas.shipment import (
    ShipmentTrackingBatchSyncRead,
    ShipmentCostUpdate,
    ShipmentCreate,
    ShipmentRead,
    ShipmentSummaryRead,
    ShipmentTrackingSyncRead,
    TrackingEventCreate,
    TrackingEventRead,
)
from app.services.activity import log_activity
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.email_flows import trigger_delivery, trigger_shipping_update
from app.services.webhooks import dispatch_webhook
from app.services.ctt_tracking import sync_ctt_tracking_for_active_shipments, sync_shipment_tracking
from app.services.orders import sync_order_status_from_tracking

import logging

_logger = logging.getLogger(__name__)

_SHIPPING_UPDATE_STATUSES = {"in_transit", "out_for_delivery", "picked_up"}
_DELIVERY_STATUSES = {"delivered"}


def _maybe_trigger_shipment_emails(db: Session, order: Order, status_norm: str | None) -> None:
    """Fire email flows inline when a tracking event changes the shipment state.

    Idempotency is enforced by the partial unique index in
    email_flow_logs, so even if both the inline trigger and the
    scheduler race we never send twice. Errors are swallowed so a
    failing email never breaks the tracking-event endpoint.
    """
    norm = (status_norm or "").lower()
    try:
        if norm in _SHIPPING_UPDATE_STATUSES:
            trigger_shipping_update(db, order)
        if norm in _DELIVERY_STATUSES:
            trigger_delivery(db, order)
    except Exception:
        _logger.warning(
            "Email flow trigger failed for order %s on status %s",
            order.id, norm, exc_info=True,
        )


router = APIRouter(prefix="/shipments", tags=["shipments"])

DEFAULT_SHIPMENTS_PER_PAGE = 100
MAX_SHIPMENTS_PER_PAGE = 200


@router.post("", response_model=ShipmentRead, status_code=status.HTTP_201_CREATED)
def create_shipment(
    payload: ShipmentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Shipment:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipments))
        .where(Order.id == payload.order_id)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    if order.shipment is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shipment already exists for this order",
        )

    shipment = Shipment(
        order=order,
        created_by_employee_id=current_user.id,
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        tracking_url=payload.tracking_url,
        shipping_status=payload.shipping_status,
        shipping_status_detail=payload.shipping_status_detail,
        provider_reference=payload.provider_reference,
        shipping_rule_id=payload.shipping_rule_id,
        shipping_rule_name=payload.shipping_rule_name,
        detected_zone=payload.detected_zone,
        resolution_mode=payload.resolution_mode,
        shipping_type_code=payload.shipping_type_code,
        weight_tier_code=payload.weight_tier_code,
        weight_tier_label=payload.weight_tier_label,
        shipping_weight_declared=payload.shipping_weight_declared,
        package_count=payload.package_count,
        provider_payload_json=payload.provider_payload_json,
        label_created_at=payload.label_created_at,
        shopify_sync_status=payload.shopify_sync_status,
        shopify_sync_error=payload.shopify_sync_error,
        shopify_last_sync_attempt_at=payload.shopify_last_sync_attempt_at,
        shopify_synced_at=payload.shopify_synced_at,
    )
    sync_order_status_from_tracking(order, "shipment_created")
    db.add(shipment)
    db.flush()
    evaluate_order_automation_rules(db=db, order=order, source="shipment_create")
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="label_created", actor=current_user,
        summary=f"{current_user.name} creó envío {shipment.carrier or ''} {shipment.tracking_number or ''}".strip(),
    )
    db.commit()
    if order.shop_id:
        dispatch_webhook(db, shop_id=order.shop_id, event="shipment.created", payload={
            "order_id": order.id, "shipment_id": shipment.id,
            "carrier": shipment.carrier, "tracking_number": shipment.tracking_number,
        })
    db.refresh(shipment)
    return db.scalar(
        select(Shipment)
        .options(
            selectinload(Shipment.events).load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.status_raw,
                TrackingEvent.source,
                TrackingEvent.location,
                TrackingEvent.occurred_at,
                TrackingEvent.created_at,
            )
        )
        .where(Shipment.id == shipment.id)
    )


@router.get("/labels-archive")
def list_labels_archive(
    employee_id: int | None = Query(None, description="Filter to one preparer; omit for all"),
    from_dt: datetime | None = Query(None, alias="from", description="ISO datetime, inclusive"),
    to_dt: datetime | None = Query(None, alias="to", description="ISO datetime, inclusive"),
    shop_id: int | None = None,
    limit: int = Query(2000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> dict:
    """List CTT tracking codes by employee + date range.

    Powers /employees/print-queue's "Histórico" action: an operator can
    rebuild the merged-PDF stack of labels someone created earlier today,
    yesterday, or in any custom window — even after those orders left the
    live print queue (production_status=completed). Read-only; the merge
    and download happen client-side via printLabelsMerged.

    Declared above /{shipment_id} on purpose: FastAPI matches by order, and
    "labels-archive" must not be coerced into the int path param.
    """
    query = (
        select(
            Shipment.id,
            Shipment.order_id,
            Shipment.tracking_number,
            Shipment.created_at,
            Shipment.created_by_employee_id,
        )
        .where(Shipment.tracking_number != "")
        .order_by(Shipment.created_at.asc(), Shipment.id.asc())
        .limit(limit)
    )

    if employee_id is not None:
        query = query.where(Shipment.created_by_employee_id == employee_id)
    if from_dt is not None:
        query = query.where(Shipment.created_at >= from_dt)
    if to_dt is not None:
        query = query.where(Shipment.created_at <= to_dt)

    needs_shop_join = shop_id is not None or accessible_shop_ids is not None
    if needs_shop_join:
        query = query.join(Shipment.order)
        if shop_id is not None:
            if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
                return {"shipments": [], "total": 0, "truncated": False}
            query = query.where(Order.shop_id == shop_id)
        elif accessible_shop_ids is not None:
            query = query.where(Order.shop_id.in_(accessible_shop_ids))

    rows = db.execute(query).all()
    shipments = [
        {
            "id": row.id,
            "order_id": row.order_id,
            "tracking_number": row.tracking_number,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "created_by_employee_id": row.created_by_employee_id,
        }
        for row in rows
    ]
    return {
        "shipments": shipments,
        "total": len(shipments),
        "truncated": len(shipments) >= limit,
    }


@router.get("/{shipment_id}", response_model=ShipmentRead)
def get_shipment(
    shipment_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shipment:
    shipment = db.scalar(
        select(Shipment)
        .options(
            selectinload(Shipment.events).load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.status_raw,
                TrackingEvent.source,
                TrackingEvent.location,
                TrackingEvent.occurred_at,
                TrackingEvent.created_at,
            )
        )
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    return shipment


@router.get("", response_model=list[ShipmentSummaryRead])
def list_shipments(
    response: Response,
    shop_id: int | None = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=DEFAULT_SHIPMENTS_PER_PAGE, ge=1, le=MAX_SHIPMENTS_PER_PAGE),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Shipment]:
    query = select(Shipment).options(
        load_only(
            Shipment.id,
            Shipment.order_id,
            Shipment.created_by_employee_id,
            Shipment.fulfillment_id,
            Shipment.carrier,
            Shipment.tracking_number,
            Shipment.tracking_url,
            Shipment.shipping_status,
            Shipment.shipping_status_detail,
            Shipment.provider_reference,
            Shipment.shipping_rule_id,
            Shipment.shipping_rule_name,
            Shipment.detected_zone,
            Shipment.resolution_mode,
            Shipment.shipping_type_code,
            Shipment.weight_tier_code,
            Shipment.weight_tier_label,
            Shipment.shipping_weight_declared,
            Shipment.package_count,
            Shipment.label_created_at,
            Shipment.shopify_sync_status,
            Shipment.shopify_sync_error,
            Shipment.shopify_last_sync_attempt_at,
            Shipment.shopify_synced_at,
            Shipment.public_token,
            Shipment.created_at,
        )
    ).order_by(
        Shipment.created_at.desc(),
        Shipment.id.desc(),
    )
    count_query = select(func.count()).select_from(Shipment)
    if accessible_shop_ids is not None and shop_id is not None and shop_id not in accessible_shop_ids:
        return []
    if shop_id is not None:
        query = query.join(Shipment.order).where(Order.shop_id == shop_id)
        count_query = count_query.join(Shipment.order).where(Order.shop_id == shop_id)
    elif accessible_shop_ids is not None:
        query = query.join(Shipment.order).where(Order.shop_id.in_(accessible_shop_ids))
        count_query = count_query.join(Shipment.order).where(Order.shop_id.in_(accessible_shop_ids))

    total_count = int(db.scalar(count_query) or 0)
    response.headers["X-Total-Count"] = str(total_count)
    safe_per_page = max(1, min(per_page, MAX_SHIPMENTS_PER_PAGE))
    safe_page = max(page, 1)
    query = query.limit(safe_per_page).offset((safe_page - 1) * safe_per_page)

    return list(db.scalars(query))


@router.post(
    "/{shipment_id}/events",
    response_model=TrackingEventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_tracking_event(
    shipment_id: int,
    payload: TrackingEventCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> TrackingEvent:
    shipment = db.get(Shipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    event = TrackingEvent(
        shipment=shipment,
        status_norm=payload.status_norm,
        status_raw=payload.status_raw,
        source=payload.source,
        location=payload.location,
        payload_json=payload.payload_json,
        occurred_at=payload.occurred_at,
    )
    sync_order_status_from_tracking(shipment.order, payload.status_norm)
    db.add(event)
    db.flush()
    evaluate_order_automation_rules(db=db, order=shipment.order, source="tracking_event_create")
    _maybe_trigger_shipment_emails(db, shipment.order, payload.status_norm)
    db.commit()
    db.refresh(event)
    return event


@router.post("/{shipment_id}/sync-tracking", response_model=ShipmentTrackingSyncRead)
def sync_single_shipment_tracking(
    shipment_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShipmentTrackingSyncRead:
    shipment = db.scalar(
        select(Shipment)
        .options(
            selectinload(Shipment.events).load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.status_raw,
                TrackingEvent.source,
                TrackingEvent.location,
                TrackingEvent.occurred_at,
                TrackingEvent.created_at,
            ),
            selectinload(Shipment.order),
        )
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    result = sync_shipment_tracking(db=db, shipment=shipment)
    db.commit()
    db.refresh(shipment)
    reloaded = db.scalar(
        select(Shipment)
        .options(
            selectinload(Shipment.events).load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.status_raw,
                TrackingEvent.source,
                TrackingEvent.location,
                TrackingEvent.occurred_at,
                TrackingEvent.created_at,
            )
        )
        .where(Shipment.id == shipment.id)
    )
    assert reloaded is not None
    return ShipmentTrackingSyncRead(
        shipment=reloaded,
        changed=result.changed,
        events_created=result.events_created,
        latest_status=result.latest_status,
        latest_raw_status=result.latest_raw_status,
        shopify_sync_status=result.shopify_sync_status or reloaded.shopify_sync_status,
    )


@router.post("/sync-active-tracking", response_model=ShipmentTrackingBatchSyncRead)
def sync_active_shipments_tracking(
    shop_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _current_user=Depends(require_admin_user),
) -> ShipmentTrackingBatchSyncRead:
    results = sync_ctt_tracking_for_active_shipments(
        db=db,
        limit=max(1, min(limit, 500)),
        shop_id=shop_id,
        log_failures=True,
    )
    db.commit()

    shipments: list[ShipmentTrackingSyncRead] = []
    changed_count = 0
    events_created = 0
    for result in results:
        shipment = db.scalar(
            select(Shipment)
            .options(
                selectinload(Shipment.events).load_only(
                    TrackingEvent.id,
                    TrackingEvent.shipment_id,
                    TrackingEvent.status_norm,
                    TrackingEvent.status_raw,
                    TrackingEvent.source,
                    TrackingEvent.location,
                    TrackingEvent.occurred_at,
                    TrackingEvent.created_at,
                )
            )
            .where(Shipment.id == result.shipment_id)
        )
        if shipment is None:
            continue
        changed_count += int(result.changed)
        events_created += result.events_created
        shipments.append(
            ShipmentTrackingSyncRead(
                shipment=shipment,
                changed=result.changed,
                events_created=result.events_created,
                latest_status=result.latest_status,
                latest_raw_status=result.latest_raw_status,
                shopify_sync_status=result.shopify_sync_status or shipment.shopify_sync_status,
            )
        )

    return ShipmentTrackingBatchSyncRead(
        synced_count=len(shipments),
        changed_count=changed_count,
        events_created=events_created,
        shipments=shipments,
    )


@router.patch("/{shipment_id}/cost", response_model=ShipmentRead)
def update_shipment_cost(
    shipment_id: int,
    payload: ShipmentCostUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Shipment:
    shipment = db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.events))
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    order = db.get(Order, shipment.order_id)
    if order and accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    shipment.shipping_cost = payload.shipping_cost
    db.commit()
    return db.scalar(
        select(Shipment).options(selectinload(Shipment.events)).where(Shipment.id == shipment_id)
    )
