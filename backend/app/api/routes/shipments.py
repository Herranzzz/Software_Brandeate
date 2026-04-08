from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user
from app.models import Order, Shipment, TrackingEvent, User
from app.schemas.shipment import (
    ShipmentTrackingBatchSyncRead,
    ShipmentCreate,
    ShipmentRead,
    ShipmentTrackingSyncRead,
    TrackingEventCreate,
    TrackingEventRead,
)
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.ctt_tracking import sync_ctt_tracking_for_active_shipments, sync_shipment_tracking
from app.services.orders import sync_order_status_from_tracking


router = APIRouter(prefix="/shipments", tags=["shipments"])


@router.post("", response_model=ShipmentRead, status_code=status.HTTP_201_CREATED)
def create_shipment(
    payload: ShipmentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Shipment:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipment))
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

    db.commit()
    db.refresh(shipment)
    return db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.events))
        .where(Shipment.id == shipment.id)
    )


@router.get("/{shipment_id}", response_model=ShipmentRead)
def get_shipment(
    shipment_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shipment:
    shipment = db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.events))
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    return shipment


@router.get("", response_model=list[ShipmentRead])
def list_shipments(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Shipment]:
    query = select(Shipment).options(selectinload(Shipment.events)).order_by(
        Shipment.created_at.desc(),
        Shipment.id.desc(),
    )
    if accessible_shop_ids is not None and shop_id is not None and shop_id not in accessible_shop_ids:
        return []
    if shop_id is not None:
        query = query.join(Shipment.order).where(Order.shop_id == shop_id)
    elif accessible_shop_ids is not None:
        query = query.join(Shipment.order).where(Order.shop_id.in_(accessible_shop_ids))

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
        .options(selectinload(Shipment.events), selectinload(Shipment.order))
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    result = sync_shipment_tracking(db=db, shipment=shipment)
    db.commit()
    db.refresh(shipment)
    reloaded = db.scalar(select(Shipment).options(selectinload(Shipment.events)).where(Shipment.id == shipment.id))
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
        shipment = db.scalar(select(Shipment).options(selectinload(Shipment.events)).where(Shipment.id == result.shipment_id))
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
