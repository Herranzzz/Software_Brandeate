import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import ssl
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
import sqlalchemy as sa
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, load_only, selectinload
from starlette.background import BackgroundTask

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, resolve_shop_scope
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import (
    DesignStatus,
    Incident,
    IncidentStatus,
    Order,
    OrderItem,
    OrderPriority,
    OrderStatus,
    PickBatch,
    PickBatchOrder,
    ProductionStatus,
    Shipment,
    Shop,
    ShopCatalogVariant,
    TrackingEvent,
    User,
)
from app.schemas.incident import IncidentRead
from app.schemas.order import (
    OrderBlockUpdate,
    OrderInternalNoteUpdate,
    OrderCreate,
    OrderDetailRead,
    OrderListRead,
    OrderPriorityUpdate,
    OrderProductionStatusUpdate,
    OrderRead,
    OrderStatusUpdate,
    OrderUpdate,
)
from app.schemas.pick_batch import (
    OrderBulkIncidentCreate,
    OrderBulkPriorityUpdate,
    OrderBulkProductionStatusUpdate,
    PickBatchCreate,
    PickBatchRead,
)
from app.services.activity import log_activity
from app.services.automation_rules import evaluate_order_automation_rules, reconcile_incident_lifecycle
from app.services.webhooks import dispatch_webhook
from app.services.orders import infer_order_is_personalized, sync_order_item_design_statuses


router = APIRouter(prefix="/orders", tags=["orders"])

DEFAULT_ORDERS_PER_PAGE = 100
MAX_ORDERS_PER_PAGE = 250


def _prepared_order_state(order: Order) -> bool:
    return order.production_status in {ProductionStatus.packed, ProductionStatus.completed} or order.status == OrderStatus.ready_to_ship


def _touch_order_activity(order: Order, user: User, *, mark_prepared: bool = False) -> None:
    now = datetime.now(timezone.utc)
    order.last_touched_by_employee_id = user.id
    order.last_touched_at = now
    if mark_prepared or _prepared_order_state(order):
        order.prepared_by_employee_id = user.id
        order.prepared_at = now


def _order_query():
    return select(Order).options(
        selectinload(Order.shop),
        selectinload(Order.items),
        selectinload(Order.incidents),
        selectinload(Order.shipment).selectinload(Shipment.events),
        selectinload(Order.prepared_by_employee).load_only(User.id, User.name),
    )


def _order_detail_query():
    return _order_query().options(selectinload(Order.automation_events))


def _order_list_query():
    return (
        select(Order)
        .options(
            selectinload(Order.items).load_only(
                OrderItem.id,
                OrderItem.order_id,
                OrderItem.product_id,
                OrderItem.variant_id,
                OrderItem.sku,
                OrderItem.name,
                OrderItem.title,
                OrderItem.variant_title,
                OrderItem.quantity,
                OrderItem.design_link,
                OrderItem.customization_provider,
                OrderItem.design_status,
                OrderItem.personalization_assets_json,
                OrderItem.created_at,
            ),
            selectinload(Order.incidents).load_only(
                Incident.id,
                Incident.order_id,
                Incident.status,
                Incident.type,
                Incident.updated_at,
            ),
            selectinload(Order.shipment)
            .load_only(
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
            .selectinload(Shipment.events)
            .load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.occurred_at,
                TrackingEvent.created_at,
            ),
            selectinload(Order.prepared_by_employee).load_only(User.id, User.name),
        )
    )


def _pick_batch_query():
    return select(PickBatch).options(selectinload(PickBatch.orders))


def _normalize_variant_label(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.lower() in {"default title", "sin variante", "no variant"}:
        return None
    return normalized


def _variant_label_from_option_values(option_values: object) -> str | None:
    if not isinstance(option_values, list):
        return None
    values: list[str] = []
    for option in option_values:
        if not isinstance(option, dict):
            continue
        value = option.get("value")
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return " · ".join(values) if values else None


def _enrich_order_variant_titles(db: Session, orders: list[Order]) -> None:
    items_to_enrich: list[tuple[int, OrderItem]] = []
    shop_ids: set[int] = set()
    variant_ids: set[str] = set()

    for order in orders:
        for item in order.items:
            if _normalize_variant_label(item.variant_title):
                continue
            if not item.variant_id:
                continue
            items_to_enrich.append((order.shop_id, item))
            shop_ids.add(order.shop_id)
            if item.variant_id:
                variant_ids.add(item.variant_id.strip())

    if not items_to_enrich or not shop_ids:
        return

    if not variant_ids:
        return

    variants = list(
        db.scalars(
            select(ShopCatalogVariant).where(
                ShopCatalogVariant.shop_id.in_(shop_ids),
                ShopCatalogVariant.external_variant_id.in_(variant_ids),
            )
        )
    )

    variants_by_id = {
        (variant.shop_id, variant.external_variant_id): variant
        for variant in variants
        if variant.external_variant_id
    }

    for shop_id, item in items_to_enrich:
        candidate = None
        if item.variant_id:
            candidate = variants_by_id.get((shop_id, item.variant_id.strip()))
        if candidate is None:
            continue
        resolved_label = _normalize_variant_label(candidate.title) or _variant_label_from_option_values(candidate.option_values_json)
        if resolved_label:
            item.variant_title = resolved_label


def _load_target_orders(
    db: Session,
    order_ids: list[int],
    accessible_shop_ids: set[int] | None,
) -> list[Order]:
    orders = list(
        db.scalars(
            select(Order)
            .options(
                selectinload(Order.items),
                selectinload(Order.incidents),
                selectinload(Order.shipment).selectinload(Shipment.events),
            )
            .where(Order.id.in_(order_ids))
        )
    )
    if len(orders) != len(set(order_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Some orders were not found")
    if accessible_shop_ids is not None and any(order.shop_id not in accessible_shop_ids for order in orders):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    return orders


@router.post("", response_model=OrderDetailRead, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    if accessible_shop_ids is not None and payload.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    shop = db.get(Shop, payload.shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    existing_order = db.scalar(
        select(Order).where(
            Order.shop_id == payload.shop_id,
            Order.external_id == payload.external_id,
        )
    )
    if existing_order is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order with this external_id already exists for the shop",
        )

    order = Order(
        shop_id=payload.shop_id,
        external_id=payload.external_id,
        shopify_order_gid=payload.shopify_order_gid,
        shopify_order_name=payload.shopify_order_name,
        customer_external_id=payload.customer_external_id,
        status=payload.status,
        production_status=payload.production_status,
        priority=payload.priority,
        is_personalized=payload.is_personalized if payload.is_personalized is not None else infer_order_is_personalized(payload.items),
        customer_name=payload.customer_name,
        customer_email=payload.customer_email,
        shipping_name=payload.shipping_name,
        shipping_phone=payload.shipping_phone,
        shipping_country_code=payload.shipping_country_code,
        shipping_postal_code=payload.shipping_postal_code,
        shipping_address_line1=payload.shipping_address_line1,
        shipping_address_line2=payload.shipping_address_line2,
        shipping_town=payload.shipping_town,
        shipping_province_code=payload.shipping_province_code,
        shopify_shipping_snapshot_json=payload.shopify_shipping_snapshot_json,
        shopify_shipping_rate_name=payload.shopify_shipping_rate_name,
        shopify_shipping_rate_amount=payload.shopify_shipping_rate_amount,
        shopify_shipping_rate_currency=payload.shopify_shipping_rate_currency,
        delivery_type=payload.delivery_type,
        shipping_service_code=payload.shipping_service_code,
        shipping_service_name=payload.shipping_service_name,
        shipping_rate_amount=payload.shipping_rate_amount,
        shipping_rate_currency=payload.shipping_rate_currency,
        shipping_rate_estimated_days_min=payload.shipping_rate_estimated_days_min,
        shipping_rate_estimated_days_max=payload.shipping_rate_estimated_days_max,
        shipping_rate_quote_id=payload.shipping_rate_quote_id,
        pickup_point_json=payload.pickup_point_json,
        note=payload.note,
        tags_json=payload.tags_json,
        channel=payload.channel,
        shopify_financial_status=payload.shopify_financial_status,
        shopify_fulfillment_status=payload.shopify_fulfillment_status,
        fulfillment_orders_json=payload.fulfillment_orders_json,
    )
    order.items = [
        item.to_model()
        for item in payload.items
    ]
    sync_order_item_design_statuses(order)
    _touch_order_activity(order, current_user)

    db.add(order)
    db.flush()
    evaluate_order_automation_rules(db=db, order=order, source="order_create")
    db.commit()
    db.refresh(order)

    return db.scalar(
        _order_detail_query().where(Order.id == order.id)
    )


def _build_order_filters(
    base_query: sa.Select,
    *,
    status: OrderStatus | None,
    production_status: ProductionStatus | None,
    design_status: DesignStatus | None,
    has_pending_asset: bool | None,
    is_prepared: bool | None,
    priority: OrderPriority | None,
    scoped_shop_ids: set[int] | None,
    is_personalized: bool | None,
    has_incident: bool | None,
    sku: str | None,
    variant_title: str | None,
    channel: str | None,
    carrier: str | None,
    q: str | None,
    is_blocked: bool | None = None,
    overdue_sla: bool | None = None,
    shipping_status: str | None = None,
) -> sa.Select:
    query = base_query
    if status is not None:
        query = query.where(Order.status == status)
    if production_status is not None:
        query = query.where(Order.production_status == production_status)
    if design_status is not None:
        query = query.where(Order.items.any(OrderItem.design_status == design_status))
    if has_pending_asset is True:
        query = query.where(
            Order.items.any(
                or_(
                    OrderItem.design_status == DesignStatus.pending_asset,
                    OrderItem.design_status == DesignStatus.missing_asset,
                )
            )
        )
    if is_prepared is not None:
        prepared_statuses = [ProductionStatus.packed, ProductionStatus.completed]
        prepared_clause = or_(
            Order.production_status.in_(prepared_statuses),
            Order.status == OrderStatus.ready_to_ship,
        )
        query = query.where(prepared_clause if is_prepared else ~prepared_clause)
    if priority is not None:
        query = query.where(Order.priority == priority)
    if scoped_shop_ids is not None:
        query = query.where(Order.shop_id.in_(scoped_shop_ids))
    if is_personalized is not None:
        query = query.where(Order.is_personalized.is_(is_personalized))
    if has_incident is not None:
        open_incident_clause = Order.incidents.any(Incident.status != IncidentStatus.resolved)
        query = query.where(open_incident_clause if has_incident else ~open_incident_clause)
    if sku is not None and sku.strip():
        normalized_sku = f"%{sku.strip()}%"
        query = query.where(Order.items.any(OrderItem.sku.ilike(normalized_sku)))
    if variant_title is not None and variant_title.strip():
        normalized_variant = f"%{variant_title.strip()}%"
        query = query.where(Order.items.any(OrderItem.variant_title.ilike(normalized_variant)))
    if channel is not None and channel.strip():
        query = query.where(Order.channel == channel.strip())
    if carrier is not None and carrier.strip():
        query = query.join(Order.shipment).where(Shipment.carrier == carrier.strip())
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Order.external_id.ilike(term),
                Order.customer_name.ilike(term),
                Order.customer_email.ilike(term),
                Order.shipping_phone.ilike(term),
                Order.items.any(OrderItem.sku.ilike(term)),
                Order.items.any(OrderItem.name.ilike(term)),
                Order.items.any(OrderItem.title.ilike(term)),
                Order.shipment.has(Shipment.tracking_number.ilike(term)),
            )
        )
    if is_blocked is not None:
        query = query.where(Order.is_blocked.is_(is_blocked))
    if overdue_sla is True:
        today = datetime.now(timezone.utc).date()
        _resolved = ("delivered", "exception", "stalled")
        query = query.join(Order.shipment).where(
            Shipment.expected_delivery_date.isnot(None),
            Shipment.expected_delivery_date < today,
            Shipment.shipping_status.notin_(_resolved),
        )
    if shipping_status is not None and shipping_status.strip():
        query = query.where(Order.shipment.has(Shipment.shipping_status == shipping_status.strip()))
    return query


@router.get("", response_model=list[OrderListRead])
def list_orders(
    response: Response,
    status: OrderStatus | None = None,
    production_status: ProductionStatus | None = None,
    design_status: DesignStatus | None = None,
    has_pending_asset: bool | None = None,
    is_prepared: bool | None = None,
    priority: OrderPriority | None = None,
    shop_id: int | None = None,
    is_personalized: bool | None = None,
    has_incident: bool | None = None,
    sku: str | None = None,
    variant_title: str | None = None,
    channel: str | None = None,
    carrier: str | None = None,
    q: str | None = None,
    is_blocked: bool | None = None,
    overdue_sla: bool | None = None,
    shipping_status: str | None = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=DEFAULT_ORDERS_PER_PAGE, ge=1, le=MAX_ORDERS_PER_PAGE),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Order]:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    lifecycle = reconcile_incident_lifecycle(db=db, scoped_shop_ids=scoped_shop_ids)
    if lifecycle["resolved_total"] > 0:
        db.commit()

    filter_kwargs = dict(
        status=status,
        production_status=production_status,
        design_status=design_status,
        has_pending_asset=has_pending_asset,
        is_prepared=is_prepared,
        priority=priority,
        scoped_shop_ids=scoped_shop_ids,
        is_personalized=is_personalized,
        has_incident=has_incident,
        sku=sku,
        variant_title=variant_title,
        channel=channel,
        carrier=carrier,
        q=q,
        is_blocked=is_blocked,
        overdue_sla=overdue_sla,
        shipping_status=shipping_status,
    )

    # Contar total antes de paginar para X-Total-Count
    count_query = _build_order_filters(
        select(func.count()).select_from(Order),
        **filter_kwargs,
    )
    total_count = db.scalar(count_query) or 0
    response.headers["X-Total-Count"] = str(total_count)

    safe_per_page = max(1, min(per_page, MAX_ORDERS_PER_PAGE))
    safe_page = max(page, 1)
    data_query = _build_order_filters(
        _order_list_query().order_by(Order.created_at.desc(), Order.id.desc()),
        **filter_kwargs,
    ).limit(safe_per_page).offset((safe_page - 1) * safe_per_page)

    orders = list(db.scalars(data_query))
    _enrich_order_variant_titles(db, orders)
    return orders


@router.post("/bulk/production-status", response_model=list[OrderListRead])
def bulk_update_order_production_status(
    payload: OrderBulkProductionStatusUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> list[Order]:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    for order in orders:
        order.production_status = payload.production_status
        _touch_order_activity(
            order,
            current_user,
            mark_prepared=payload.production_status in {ProductionStatus.packed, ProductionStatus.completed},
        )
        evaluate_order_automation_rules(db=db, order=order, source="bulk_production_status")
    db.commit()
    return list(
        db.scalars(
            _order_list_query().where(Order.id.in_(payload.order_ids)).order_by(Order.created_at.desc(), Order.id.desc())
        )
    )


@router.post("/bulk/priority", response_model=list[OrderListRead])
def bulk_update_order_priority(
    payload: OrderBulkPriorityUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> list[Order]:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    for order in orders:
        order.priority = payload.priority
        _touch_order_activity(order, current_user)
    db.commit()
    return list(
        db.scalars(
            _order_list_query().where(Order.id.in_(payload.order_ids)).order_by(Order.created_at.desc(), Order.id.desc())
        )
    )


@router.post("/bulk/incidents", response_model=list[IncidentRead], status_code=status.HTTP_201_CREATED)
def bulk_create_order_incidents(
    payload: OrderBulkIncidentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> list[Incident]:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    incidents: list[Incident] = []
    for order in orders:
        incident = Incident(
            order_id=order.id,
            type=payload.type,
            priority=payload.priority,
            status=IncidentStatus.open,
            title=payload.title,
            description=payload.description,
            last_touched_by_employee_id=current_user.id,
            last_touched_at=datetime.now(timezone.utc),
        )
        db.add(incident)
        incidents.append(incident)
        _touch_order_activity(order, current_user)
    db.commit()
    return list(
        db.scalars(
            select(Incident)
            .options(selectinload(Incident.order))
            .where(Incident.order_id.in_(payload.order_ids))
            .order_by(Incident.created_at.desc(), Incident.id.desc())
            .limit(len(payload.order_ids))
        )
    )


@router.post("/batches", response_model=PickBatchRead, status_code=status.HTTP_201_CREATED)
def create_pick_batch(
    payload: PickBatchCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> PickBatch:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    distinct_shop_ids = {order.shop_id for order in orders}
    shop_id = next(iter(distinct_shop_ids)) if len(distinct_shop_ids) == 1 else None

    batch = PickBatch(
        shop_id=shop_id,
        status=payload.status,
        notes=payload.notes,
        orders_count=len(orders),
    )
    batch.orders = [PickBatchOrder(order_id=order.id) for order in orders]
    for order in orders:
        _touch_order_activity(order, current_user)
    db.add(batch)
    db.commit()
    return db.scalar(_pick_batch_query().where(PickBatch.id == batch.id))


@router.get("/batches", response_model=list[PickBatchRead])
def list_pick_batches(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[PickBatch]:
    query = _pick_batch_query().order_by(PickBatch.created_at.desc(), PickBatch.id.desc())
    if shop_id is not None:
        query = query.where(PickBatch.shop_id == shop_id)
    if accessible_shop_ids is not None:
        if shop_id is not None and shop_id not in accessible_shop_ids:
            return []
        query = query.where((PickBatch.shop_id.is_(None)) | (PickBatch.shop_id.in_(accessible_shop_ids)))
    return list(db.scalars(query))


@router.get("/export", response_class=Response)
def export_orders_csv(
    status: OrderStatus | None = None,
    production_status: ProductionStatus | None = None,
    design_status: DesignStatus | None = None,
    has_pending_asset: bool | None = None,
    is_prepared: bool | None = None,
    priority: OrderPriority | None = None,
    shop_id: int | None = None,
    is_personalized: bool | None = None,
    has_incident: bool | None = None,
    sku: str | None = None,
    variant_title: str | None = None,
    channel: str | None = None,
    carrier: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Response:
    """Exporta los pedidos filtrados como un archivo CSV."""
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    lifecycle = reconcile_incident_lifecycle(db=db, scoped_shop_ids=scoped_shop_ids)
    if lifecycle["resolved_total"] > 0:
        db.commit()

    filter_kwargs = dict(
        status=status,
        production_status=production_status,
        design_status=design_status,
        has_pending_asset=has_pending_asset,
        is_prepared=is_prepared,
        priority=priority,
        scoped_shop_ids=scoped_shop_ids,
        is_personalized=is_personalized,
        has_incident=has_incident,
        sku=sku,
        variant_title=variant_title,
        channel=channel,
        carrier=carrier,
        q=q,
    )
    data_query = _build_order_filters(
        _order_query().order_by(Order.created_at.desc(), Order.id.desc()),
        **filter_kwargs,
    ).limit(10_000)

    orders = list(db.scalars(data_query))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "external_id", "shopify_order_name", "created_at",
        "customer_name", "customer_email",
        "status", "production_status", "priority",
        "is_personalized", "channel",
        "sku", "product_name", "variant", "quantity",
        "carrier", "tracking_number", "tracking_url",
        "open_incidents",
    ])
    for order in orders:
        primary = order.items[0] if order.items else None
        created_at = order.created_at
        if created_at and created_at.tzinfo is not None:
            created_at = created_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        writer.writerow([
            order.id,
            order.external_id,
            order.shopify_order_name or "",
            created_at,
            order.customer_name,
            order.customer_email,
            order.status.value if order.status else "",
            order.production_status.value if order.production_status else "",
            order.priority.value if order.priority else "",
            "sí" if order.is_personalized else "no",
            order.channel or "",
            primary.sku if primary else "",
            (primary.title or primary.name) if primary else "",
            primary.variant_title or "" if primary else "",
            primary.quantity if primary else "",
            order.shipment.carrier if order.shipment else "",
            order.shipment.tracking_number if order.shipment else "",
            order.shipment.tracking_url or "" if order.shipment else "",
            order.open_incidents_count,
        ])

    csv_content = output.getvalue()
    return Response(
        content=csv_content.encode("utf-8-sig"),  # utf-8-sig para compatibilidad con Excel
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pedidos.csv"},
    )


@router.get("/sla-alerts")
def get_sla_alerts(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Return count of orders with breached SLA."""
    from datetime import timedelta

    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    cutoff_3d = datetime.now(timezone.utc) - timedelta(days=3)
    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)

    base_q = (
        select(func.count())
        .select_from(Order)
        .outerjoin(Shipment, Shipment.order_id == Order.id)
        .where(Order.status.notin_(["delivered", "cancelled"]))
    )
    if scope is not None:
        base_q = base_q.where(Order.shop_id.in_(scope))

    # Orders without shipment for 3+ days
    no_shipment_3d = db.scalar(
        base_q.where(Shipment.id == None).where(Order.created_at < cutoff_3d)
    ) or 0

    # In transit 7+ days
    stalled_transit = db.scalar(
        base_q.where(
            Shipment.shipping_status.in_(["in_transit", "picked_up"]),
            Shipment.created_at < cutoff_7d,
        )
    ) or 0

    return {
        "no_shipment_3d": no_shipment_3d,
        "stalled_transit_7d": stalled_transit,
        "total_alerts": no_shipment_3d + stalled_transit,
    }


@router.get("/{order_id}", response_model=OrderDetailRead)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Order:
    order = db.scalar(_order_detail_query().where(Order.id == order_id))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    _enrich_order_variant_titles(db, [order])
    return order


@router.get("/{order_id}/incidents", response_model=list[IncidentRead])
def get_order_incidents(
    order_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Incident]:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    return list(
        db.scalars(
            select(Incident)
            .options(selectinload(Incident.order))
            .where(Incident.order_id == order_id)
            .order_by(Incident.updated_at.desc(), Incident.id.desc())
        )
    )


@router.patch("/{order_id}/status", response_model=OrderDetailRead)
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    old_status = order.status
    order.status = payload.status
    _touch_order_activity(order, current_user, mark_prepared=payload.status == OrderStatus.ready_to_ship)
    evaluate_order_automation_rules(db=db, order=order, source="order_status_update")
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="status_changed", actor=current_user,
        summary=f"{current_user.name} cambió estado de {old_status.value} a {payload.status.value}",
        detail={"old": old_status.value, "new": payload.status.value},
    )
    db.commit()
    if order.shop_id:
        dispatch_webhook(db, shop_id=order.shop_id, event="order.status_changed", payload={
            "order_id": order.id, "external_id": order.external_id,
            "old_status": old_status.value, "new_status": payload.status.value,
        })
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}/production-status", response_model=OrderDetailRead)
def update_order_production_status(
    order_id: int,
    payload: OrderProductionStatusUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    old_prod = order.production_status
    order.production_status = payload.production_status
    _touch_order_activity(
        order,
        current_user,
        mark_prepared=payload.production_status in {ProductionStatus.packed, ProductionStatus.completed},
    )
    evaluate_order_automation_rules(db=db, order=order, source="order_production_update")
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="status_changed", actor=current_user,
        summary=f"{current_user.name} cambió producción de {old_prod.value} a {payload.production_status.value}",
        detail={"field": "production_status", "old": old_prod.value, "new": payload.production_status.value},
    )
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}/priority", response_model=OrderDetailRead)
def update_order_priority(
    order_id: int,
    payload: OrderPriorityUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    old_priority = order.priority
    order.priority = payload.priority
    _touch_order_activity(order, current_user)
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="updated", actor=current_user,
        summary=f"{current_user.name} cambió prioridad a {payload.priority.value}",
        detail={"field": "priority", "old": old_priority.value, "new": payload.priority.value},
    )
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}/internal-note", response_model=OrderDetailRead)
def update_order_internal_note(
    order_id: int,
    payload: OrderInternalNoteUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    order.internal_note = payload.internal_note
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.post("/{order_id}/block", response_model=OrderDetailRead)
def block_order(
    order_id: int,
    payload: OrderBlockUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    order.is_blocked = True
    order.block_reason = payload.reason
    _touch_order_activity(order, current_user)
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="updated", actor=current_user,
        summary=f"{current_user.name} bloqueó el pedido" + (f": {payload.reason}" if payload.reason else ""),
        detail={"field": "is_blocked", "new": True, "reason": payload.reason},
    )
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.post("/{order_id}/unblock", response_model=OrderDetailRead)
def unblock_order(
    order_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    order.is_blocked = False
    order.block_reason = None
    _touch_order_activity(order, current_user)
    log_activity(
        db, entity_type="order", entity_id=order.id, shop_id=order.shop_id,
        action="updated", actor=current_user,
        summary=f"{current_user.name} desbloqueó el pedido",
        detail={"field": "is_blocked", "new": False},
    )
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}", response_model=OrderDetailRead)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(order, key, value)

    _touch_order_activity(order, current_user)
    evaluate_order_automation_rules(db=db, order=order, source="order_update")
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.post("/{order_id}/items/{item_id}/report-broken-asset")
def report_broken_asset(
    order_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Mark an item's design asset as broken, setting design_status to pending_asset."""
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    item = next((i for i in order.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    if item.design_status != DesignStatus.pending_asset:
        item.design_status = DesignStatus.pending_asset
        _touch_order_activity(order, current_user)
        evaluate_order_automation_rules(db=db, order=order, source="broken_asset_report")
        db.commit()

    return {"ok": True, "design_status": "pending_asset"}


# ── Bulk design download ──────────────────────────────────────────────────────

_HIDDEN_ASSET_TYPES = frozenset({
    "_customization_image", "customization_image",
    "_preview_image", "preview_image",
})

_KNOWN_IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", ".tiff", ".tif"})

_CONTENT_TYPE_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/tiff": ".tiff",
    "application/pdf": ".pdf",
}

_DESIGN_FETCH_TIMEOUT = 15  # seconds per asset
_DESIGN_FETCH_PARALLELISM = 1  # sequential — keep peak RAM low on 512MB hosts
_DESIGN_FETCH_CHUNK_SIZE = 64 * 1024  # 64 KB chunks — smaller = less peak RAM
_DESIGN_MAX_ASSET_BYTES = 15 * 1024 * 1024  # 15 MB max per design file
_DESIGN_MAX_FILES_PER_JOB = 60  # hard cap on files per ZIP to prevent OOM
_DESIGN_JOB_TTL_SECONDS = 2 * 60 * 60
_DESIGN_JOB_CLEANUP_INTERVAL_SECONDS = 60
_DESIGN_DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60
_DESIGN_JOB_MAX_WORKERS = 1

_design_job_executor = ThreadPoolExecutor(max_workers=_DESIGN_JOB_MAX_WORKERS, thread_name_prefix="bulk-design-job")
_design_jobs_lock = threading.Lock()
_design_jobs: dict[str, dict] = {}
_design_jobs_last_cleanup = 0.0


def _now_ts() -> int:
    return int(time.time())


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("utf-8")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _encode_download_token(payload: dict) -> str:
    encoded_payload = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        get_settings().auth_secret.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_b64encode(signature)}"


def _decode_download_token(token: str) -> dict:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid download token") from exc

    expected_signature = hmac.new(
        get_settings().auth_secret.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(_b64decode(encoded_signature), expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid download token")

    try:
        payload = json.loads(_b64decode(encoded_payload).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid download token") from exc

    if int(payload.get("exp", 0)) < _now_ts():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Download token expired")
    return payload


def _safe_remove(path: str | None) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        return
    except Exception:
        return


def _cleanup_bulk_design_jobs(*, force: bool = False) -> None:
    global _design_jobs_last_cleanup
    now = _now_ts()
    with _design_jobs_lock:
        if not force and (now - _design_jobs_last_cleanup) < _DESIGN_JOB_CLEANUP_INTERVAL_SECONDS:
            return
        _design_jobs_last_cleanup = now
        expired_ids: list[str] = []
        for job_id, job in _design_jobs.items():
            updated_at = int(job.get("updated_at", now))
            if now - updated_at > _DESIGN_JOB_TTL_SECONDS:
                expired_ids.append(job_id)
        for job_id in expired_ids:
            job = _design_jobs.pop(job_id, None)
            if job is None:
                continue
            _safe_remove(job.get("zip_path"))


def _score_asset_type(type_str: str) -> int:
    t = type_str.lower()
    if "_tib_design_link" in t:
        return 10
    if "render" in t:
        return 5
    if "preview" in t:
        return 4
    if "mockup" in t:
        return 3
    if t in _HIDDEN_ASSET_TYPES:
        return -1
    if "image" in t:
        return 2
    if "design" in t:
        return 1
    return 0


def _extract_assets_from_json(raw: object) -> list[tuple[str, str]]:
    """Returns list of (asset_type, url) from personalization_assets_json."""
    if not raw:
        return []
    if isinstance(raw, list):
        result: list[tuple[str, str]] = []
        for entry in raw:
            if isinstance(entry, str) and entry.strip():
                result.append(("unknown", entry.strip()))
            elif isinstance(entry, dict):
                url = entry.get("url") or entry.get("value", "")
                t = entry.get("type", "unknown")
                if isinstance(url, str) and url.strip():
                    result.append((str(t), url.strip()))
        return result
    if isinstance(raw, dict):
        result = []
        for key, value in raw.items():
            if isinstance(value, str) and value.strip():
                result.append((key, value.strip()))
            elif isinstance(value, dict):
                url = value.get("url", "")
                if isinstance(url, str) and url.strip():
                    result.append((key, url.strip()))
        return result
    return []


def _get_primary_design_url(item: OrderItem) -> str | None:
    assets = _extract_assets_from_json(item.personalization_assets_json)
    visible = [(t, url) for t, url in assets if t.lower() not in _HIDDEN_ASSET_TYPES]
    if visible:
        best = max(visible, key=lambda a: _score_asset_type(a[0]))
        if _score_asset_type(best[0]) >= 0 and best[1]:
            return best[1]
    if item.design_link and item.design_link.strip():
        return item.design_link.strip()
    return None


def _guess_ext_from_url(url: str) -> str:
    try:
        path = urlparse(url).path.lower()
        for ext in _KNOWN_IMAGE_EXTS:
            if path.endswith(ext):
                return ext
    except Exception:
        pass
    return ""


def _sanitize_filename(name: str) -> str:
    """Remove characters invalid for filenames across OS."""
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    sanitized = sanitized.strip(". ")
    return sanitized or "diseño"


def _unique_name(base: str, ext: str, used: set[str]) -> str:
    candidate = f"{base}{ext}"
    if candidate not in used:
        return candidate
    counter = 1
    while True:
        candidate = f"{base} ({counter}){ext}"
        if candidate not in used:
            return candidate
        counter += 1


_30X40_PATTERN  = re.compile(r'30\s*[xX×*]\s*40', re.IGNORECASE)
_18X24_PATTERN  = re.compile(r'18\s*[xX×*]\s*24', re.IGNORECASE)
_CUT_MARGIN_MM  = 20  # 2 cm cut margin for A3 print PDFs


def _detect_print_variant(item: "OrderItem") -> str | None:
    """Return '30x40', '18x24', or None based on variant/name."""
    variant = (item.variant_title or "").strip()
    name    = (item.name or item.title or "").strip()
    if _30X40_PATTERN.search(variant) or _30X40_PATTERN.search(name):
        return "30x40"
    if _18X24_PATTERN.search(variant) or _18X24_PATTERN.search(name):
        return "18x24"
    return None


# Keep backward-compat helper used elsewhere
def _is_30x40_product(item: "OrderItem") -> bool:
    return _detect_print_variant(item) == "30x40"


def _image_has_white_background(pil_img: object) -> bool:
    """Return True if the image has a predominantly white/light background.

    Samples corners and edge midpoints. If ≥70% of sampled pixels are
    near-white (all RGB channels > 230), the image is considered white-bg.
    Expects an already-converted RGB image to avoid allocating a copy.
    """
    w, h = pil_img.size  # type: ignore[union-attr]
    sample_points = [
        (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),          # corners
        (w // 2, 0), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1),  # edge midpoints
        (w // 4, 0), (3 * w // 4, 0),                              # top edge quarters
        (0, h // 4), (w - 1, h // 4),                              # side edge quarters
    ]
    white_count = sum(
        1 for x, y in sample_points
        if all(ch > 230 for ch in pil_img.getpixel((x, y)))  # type: ignore[union-attr]
    )
    return white_count >= len(sample_points) * 0.7


def _generate_a3_print_pdf(image_path: str, output_path: str) -> None:
    """Embed a design image into an A3 PDF with a 2cm cut/trim line.

    Memory-safe: opens PIL image inside a try/finally to guarantee .close().
    """
    import gc
    from PIL import Image as PilImage
    from reportlab.lib.pagesizes import A3, landscape as rl_landscape
    from reportlab.lib import colors
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.lib.utils import ImageReader

    PT_PER_MM = 2.834645669
    A3_portrait_w, A3_portrait_h = A3

    pil_img = None
    try:
        pil_img = PilImage.open(image_path).convert("RGB")
        img_w, img_h = pil_img.size
        is_landscape_img = img_w > img_h
        is_white_bg = _image_has_white_background(pil_img)
        img_reader = ImageReader(pil_img)

        margin_pt = _CUT_MARGIN_MM * PT_PER_MM
        tick = 5 * PT_PER_MM

        if is_landscape_img:
            page_w, page_h = rl_landscape(A3)
            c = Canvas(output_path, pagesize=(page_w, page_h))
            cut_x = page_w - margin_pt
            if is_white_bg:
                c.drawImage(img_reader, 0, 0, width=cut_x, height=page_h, preserveAspectRatio=False)
            else:
                c.drawImage(img_reader, 0, 0, width=page_w, height=page_h, preserveAspectRatio=False)
            c.setStrokeColor(colors.red)
            c.setLineWidth(0.7)
            c.setDash(8, 4)
            c.line(cut_x, 0, cut_x, page_h)
            c.setDash()
            c.line(cut_x, page_h, cut_x + tick, page_h)
            c.line(cut_x, 0,      cut_x + tick, 0)
        else:
            page_w, page_h = A3_portrait_w, A3_portrait_h
            c = Canvas(output_path, pagesize=A3)
            cut_y = page_h - margin_pt
            if is_white_bg:
                c.drawImage(img_reader, 0, 0, width=page_w, height=cut_y, preserveAspectRatio=False)
            else:
                c.drawImage(img_reader, 0, 0, width=page_w, height=page_h, preserveAspectRatio=False)
            c.setStrokeColor(colors.red)
            c.setLineWidth(0.7)
            c.setDash(8, 4)
            c.line(0, cut_y, page_w, cut_y)
            c.setDash()
            c.line(0,      cut_y, 0,      cut_y - tick)
            c.line(page_w, cut_y, page_w, cut_y - tick)
        c.save()
    finally:
        if pil_img is not None:
            pil_img.close()
        del pil_img
        gc.collect()


def _generate_a4_print_pdf(image_path: str, output_path: str) -> None:
    """Embed 18×24cm design into top-left corner of A4. Memory-safe."""
    import gc
    from PIL import Image as PilImage
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.lib.utils import ImageReader

    PT = 2.834645669
    pil_img = None
    try:
        pil_img = PilImage.open(image_path).convert("RGB")
        img_w, img_h = pil_img.size
        is_landscape = img_w > img_h

        if is_landscape:
            page_w, page_h = landscape(A4)
            design_w_mm, design_h_mm = 240.0, 180.0
        else:
            page_w, page_h = A4
            design_w_mm, design_h_mm = 180.0, 240.0

        dw = design_w_mm * PT
        dh = design_h_mm * PT
        y0 = page_h - dh

        img_reader = ImageReader(pil_img)
        pagesize = landscape(A4) if is_landscape else A4
        c = Canvas(output_path, pagesize=pagesize)
        c.drawImage(img_reader, 0, y0, width=dw, height=dh, preserveAspectRatio=False)
        c.setStrokeColor(colors.Color(0.898, 0.224, 0.208))
        c.setLineWidth(0.7)
        c.setDash(8, 4)
        c.line(dw, 0, dw, page_h)
        c.line(0, y0, page_w, y0)
        c.save()
    finally:
        if pil_img is not None:
            pil_img.close()
        del pil_img
        gc.collect()


def _download_asset_to_temp(url: str) -> tuple[str, str]:
    """Fetch asset to a temporary file; returns (temp_path, detected_ext)."""
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "BrandeateOps/1.0"})
    fd, temp_path = tempfile.mkstemp(prefix="bulk-design-asset-", suffix=".tmp")
    os.close(fd)
    bytes_read = 0
    try:
        with urllib.request.urlopen(req, timeout=_DESIGN_FETCH_TIMEOUT, context=ctx) as resp:
            content_type = (resp.headers.get("Content-Type") or "").lower().split(";")[0].strip()
            ext = _CONTENT_TYPE_EXT.get(content_type, "")

            content_length_raw = (resp.headers.get("Content-Length") or "").strip()
            if content_length_raw:
                try:
                    content_length = int(content_length_raw)
                except ValueError:
                    content_length = 0
                if content_length > _DESIGN_MAX_ASSET_BYTES:
                    raise ValueError(
                        f"El archivo remoto excede el límite de {_DESIGN_MAX_ASSET_BYTES // (1024 * 1024)}MB."
                    )

            with open(temp_path, "wb") as tmp:
                while True:
                    chunk = resp.read(_DESIGN_FETCH_CHUNK_SIZE)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    if bytes_read > _DESIGN_MAX_ASSET_BYTES:
                        raise ValueError(
                            f"El archivo remoto excede el límite de {_DESIGN_MAX_ASSET_BYTES // (1024 * 1024)}MB."
                        )
                    tmp.write(chunk)

        if bytes_read == 0:
            raise ValueError("El archivo remoto está vacío.")

        return temp_path, ext
    except Exception:
        _safe_remove(temp_path)
        raise


def _build_design_download_jobs(orders: list[Order]) -> tuple[list[dict], list[dict]]:
    results: list[dict] = []
    download_jobs: list[dict] = []
    for order in orders:
        items_with_design: list[tuple[OrderItem, str]] = []
        for item in order.items:
            design_url = _get_primary_design_url(item)
            if design_url:
                items_with_design.append((item, design_url))

        if not items_with_design:
            results.append({
                "order_id": order.id,
                "external_id": order.external_id,
                "status": "no_design",
            })
            continue

        for item, design_url in items_with_design:
            item_name = (item.name or item.title or "Producto").strip()
            url_ext = _guess_ext_from_url(design_url)
            base = _sanitize_filename(f"{order.external_id} - {item_name}")
            download_jobs.append(
                {
                    "order_id": order.id,
                    "external_id": order.external_id,
                    "design_url": design_url,
                    "base": base,
                    "url_ext": url_ext,
                    "print_variant": _detect_print_variant(item),
                }
            )
    return download_jobs, results


def _summarize_design_results(results: list[dict]) -> tuple[int, int, int]:
    ok_count = sum(1 for r in results if r["status"] == "ok")
    failed_count = sum(1 for r in results if r["status"] == "failed")
    no_design_count = sum(1 for r in results if r["status"] == "no_design")
    return ok_count, failed_count, no_design_count


def _job_public_payload(job: dict) -> dict:
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "progress_total": int(job.get("progress_total", 0)),
        "progress_done": int(job.get("progress_done", 0)),
        "ok_count": int(job.get("ok_count", 0)),
        "failed_count": int(job.get("failed_count", 0)),
        "no_design_count": int(job.get("no_design_count", 0)),
        "error": job.get("error"),
        "ready": bool(job.get("status") == "done"),
    }


def _run_bulk_design_job(job_id: str) -> None:
    """Background worker for bulk design download.

    Processes files ONE AT A TIME to keep peak memory low (~25-60 MB per file
    instead of N × 60 MB when running in parallel). Critical for 512 MB hosts.
    Uses ZIP_STORED because PNG/JPG are already compressed — re-deflating them
    wastes CPU and doubles their memory footprint.
    """
    import gc

    db = SessionLocal()
    zip_path: str | None = None
    try:
        _cleanup_bulk_design_jobs()
        with _design_jobs_lock:
            job = _design_jobs.get(job_id)
            if job is None:
                return
            order_ids = list(job.get("order_ids") or [])
            scope = job.get("accessible_shop_ids")
            accessible_shop_ids = set(scope) if isinstance(scope, list) else None
            job["status"] = "running"
            job["updated_at"] = _now_ts()

        orders = list(
            db.scalars(
                select(Order)
                .options(selectinload(Order.items))
                .where(Order.id.in_(order_ids))
            )
        )
        if accessible_shop_ids is not None:
            orders = [order for order in orders if order.shop_id in accessible_shop_ids]

        download_jobs, results = _build_design_download_jobs(orders)
        # Release ORM objects immediately
        del orders
        gc.collect()

        # Hard cap on number of files to prevent OOM on low-memory hosts
        if len(download_jobs) > _DESIGN_MAX_FILES_PER_JOB:
            download_jobs = download_jobs[:_DESIGN_MAX_FILES_PER_JOB]

        with _design_jobs_lock:
            job = _design_jobs.get(job_id)
            if job is None:
                return
            job["progress_total"] = len(download_jobs)
            job["no_design_count"] = sum(1 for r in results if r["status"] == "no_design")
            job["updated_at"] = _now_ts()

        if not download_jobs:
            with _design_jobs_lock:
                job = _design_jobs.get(job_id)
                if job is None:
                    return
                job["status"] = "failed"
                job["error"] = "Los pedidos seleccionados no tienen diseños visibles para descargar."
                job["updated_at"] = _now_ts()
            return

        fd, zip_path = tempfile.mkstemp(prefix="bulk-design-", suffix=".zip")
        os.close(fd)

        used_names: set[str] = set()
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for current_job in download_jobs:
                temp_path: str | None = None
                try:
                    temp_path, fetched_ext = _download_asset_to_temp(current_job["design_url"])
                    # ── NO PIL / NO REPORTLAB ──────────────────────────────
                    # Raw image goes straight into the ZIP.  PDF generation
                    # (PIL + reportlab) decompresses images to 60-300 MB of
                    # RAM which OOM-kills the process on 512 MB hosts.
                    # Print-variant suffix is preserved in the filename so
                    # users know which size it is.
                    print_variant = current_job.get("print_variant")
                    ext = current_job["url_ext"] or fetched_ext or ".bin"
                    suffix = f" [{print_variant}]" if print_variant else ""
                    filename = _unique_name(current_job["base"] + suffix, ext, used_names)
                    used_names.add(filename)
                    zf.write(temp_path, arcname=filename)
                    results.append({
                        "order_id": current_job["order_id"],
                        "external_id": current_job["external_id"],
                        "status": "ok",
                        "filename": filename,
                    })
                except Exception as exc:
                    results.append({
                        "order_id": current_job["order_id"],
                        "external_id": current_job["external_id"],
                        "status": "failed",
                        "reason": str(exc)[:200],
                    })
                finally:
                    _safe_remove(temp_path)
                    gc.collect()
                    ok_count, failed_count, no_design_count = _summarize_design_results(results)
                    with _design_jobs_lock:
                        job = _design_jobs.get(job_id)
                        if job is not None:
                            job["progress_done"] = int(job.get("progress_done", 0)) + 1
                            job["ok_count"] = ok_count
                            job["failed_count"] = failed_count
                            job["no_design_count"] = no_design_count
                            job["updated_at"] = _now_ts()

        ok_count, failed_count, no_design_count = _summarize_design_results(results)
        if ok_count == 0:
            _safe_remove(zip_path)
            failed_example = next((r.get("reason") for r in results if r["status"] == "failed" and r.get("reason")), None)
            detail = "No se pudo descargar ningún diseño."
            if failed_example:
                detail = f"{detail} Ejemplo: {failed_example}"
            elif no_design_count > 0:
                detail = "Los pedidos seleccionados no tienen diseños visibles para descargar."
            with _design_jobs_lock:
                job = _design_jobs.get(job_id)
                if job is None:
                    return
                job["status"] = "failed"
                job["error"] = detail
                job["ok_count"] = ok_count
                job["failed_count"] = failed_count
                job["no_design_count"] = no_design_count
                job["zip_path"] = None
                job["updated_at"] = _now_ts()
            return

        # Mark downloaded print orders as "in_production"
        downloaded_order_ids = {
            r["order_id"] for r in results
            if r.get("status") == "ok" and r.get("order_id")
        }
        if downloaded_order_ids:
            try:
                print_orders = list(db.scalars(
                    select(Order)
                    .options(selectinload(Order.items))
                    .where(Order.id.in_(downloaded_order_ids))
                ))
                for ord_ in print_orders:
                    has_print_variant = any(
                        _detect_print_variant(it) is not None for it in (ord_.items or [])
                    )
                    if has_print_variant and ord_.production_status == ProductionStatus.pending_personalization:
                        ord_.production_status = ProductionStatus.in_production
                        log_activity(
                            db,
                            entity_type="order",
                            entity_id=ord_.id,
                            shop_id=ord_.shop_id,
                            action="status_changed",
                            actor=None,
                            summary="Diseño descargado — pedido marcado como En producción",
                        )
                db.commit()
                del print_orders
            except Exception:
                pass

        with _design_jobs_lock:
            job = _design_jobs.get(job_id)
            if job is None:
                _safe_remove(zip_path)
                return
            job["status"] = "done"
            job["error"] = None
            job["ok_count"] = ok_count
            job["failed_count"] = failed_count
            job["no_design_count"] = no_design_count
            job["zip_path"] = zip_path
            job["updated_at"] = _now_ts()
    except Exception as exc:
        _safe_remove(zip_path)
        with _design_jobs_lock:
            job = _design_jobs.get(job_id)
            if job is None:
                return
            job["status"] = "failed"
            job["error"] = str(exc)[:300]
            job["updated_at"] = _now_ts()
    finally:
        db.close()
        gc.collect()


@router.post("/bulk/download-designs/jobs", status_code=status.HTTP_202_ACCEPTED)
def create_bulk_design_download_job(
    payload: "BulkDesignDownloadRequest",
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> dict:
    _cleanup_bulk_design_jobs()
    if not payload.order_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selecciona al menos un pedido.")

    job_id = str(uuid.uuid4())
    now = _now_ts()
    job_state = {
        "job_id": job_id,
        "user_id": current_user.id,
        "order_ids": list(payload.order_ids),
        "accessible_shop_ids": sorted(accessible_shop_ids) if accessible_shop_ids is not None else None,
        "status": "queued",
        "progress_total": 0,
        "progress_done": 0,
        "ok_count": 0,
        "failed_count": 0,
        "no_design_count": 0,
        "error": None,
        "zip_path": None,
        "created_at": now,
        "updated_at": now,
    }
    with _design_jobs_lock:
        _design_jobs[job_id] = job_state
    _design_job_executor.submit(_run_bulk_design_job, job_id)
    return _job_public_payload(job_state)


@router.get("/bulk/download-designs/jobs/{job_id}", status_code=status.HTTP_200_OK)
def get_bulk_design_download_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    _cleanup_bulk_design_jobs()
    with _design_jobs_lock:
        job = _design_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job no encontrado o expirado.")
        if int(job.get("user_id", 0)) != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este job.")
        return _job_public_payload(job)


@router.post("/bulk/download-designs/jobs/{job_id}/download-url", status_code=status.HTTP_200_OK)
def get_bulk_design_download_url(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    _cleanup_bulk_design_jobs()
    with _design_jobs_lock:
        job = _design_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job no encontrado o expirado.")
        if int(job.get("user_id", 0)) != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este job.")
        if job.get("status") != "done":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La descarga todavía se está preparando.")
        if not job.get("zip_path"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El archivo ZIP todavía no está disponible.")

    expires_at = _now_ts() + _DESIGN_DOWNLOAD_TOKEN_TTL_SECONDS
    token = _encode_download_token(
        {
            "type": "bulk_design_download",
            "sub": current_user.id,
            "job_id": job_id,
            "exp": expires_at,
        }
    )
    return {
        "job_id": job_id,
        "token": token,
        "expires_at": expires_at,
        "download_path": f"/orders/bulk/download-designs/jobs/{job_id}/download?token={token}",
    }


@router.get("/bulk/download-designs/jobs/{job_id}/download", status_code=status.HTTP_200_OK)
def download_bulk_design_job_file(
    job_id: str,
    token: str = Query(..., min_length=10),
) -> FileResponse:
    _cleanup_bulk_design_jobs()
    payload = _decode_download_token(token)
    if payload.get("type") != "bulk_design_download":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid download token")
    if str(payload.get("job_id")) != job_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid download token")

    with _design_jobs_lock:
        job = _design_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job no encontrado o expirado.")
        if int(job.get("user_id", 0)) != int(payload.get("sub", -1)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este job.")
        zip_path = str(job.get("zip_path") or "")
        if job.get("status") != "done" or not zip_path:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La descarga todavía no está lista.")
        ok_count = int(job.get("ok_count", 0))
        failed_count = int(job.get("failed_count", 0))
        no_design_count = int(job.get("no_design_count", 0))

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El archivo ya no está disponible.")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename="diseños-bulk.zip",
        headers={
            "X-Design-Results": str(ok_count),
            "X-Design-Failures": str(failed_count),
            "X-Design-No-Design": str(no_design_count),
        },
    )


@router.post("/bulk/download-designs", status_code=status.HTTP_200_OK)
def bulk_download_designs(
    payload: "BulkDesignDownloadRequest",
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Response:
    """Generate and return a ZIP file with design assets for selected orders."""
    _cleanup_bulk_design_jobs()
    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.id.in_(payload.order_ids))
        )
    )

    if accessible_shop_ids is not None:
        orders = [order for order in orders if order.shop_id in accessible_shop_ids]

    fd, zip_path = tempfile.mkstemp(prefix="bulk-design-sync-", suffix=".zip")
    os.close(fd)
    used_names: set[str] = set()
    download_jobs, results = _build_design_download_jobs(orders)

    import gc

    del orders  # release order objects early
    gc.collect()

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for job in download_jobs:
                temp_path: str | None = None
                try:
                    temp_path, fetched_ext = _download_asset_to_temp(job["design_url"])
                    ext = job["url_ext"] or fetched_ext or ".bin"
                    filename = _unique_name(job["base"], ext, used_names)
                    used_names.add(filename)
                    zf.write(temp_path, arcname=filename)
                    results.append({
                        "order_id": job["order_id"],
                        "external_id": job["external_id"],
                        "status": "ok",
                        "filename": filename,
                    })
                except Exception as exc:
                    results.append({
                        "order_id": job["order_id"],
                        "external_id": job["external_id"],
                        "status": "failed",
                        "reason": str(exc)[:200],
                    })
                finally:
                    _safe_remove(temp_path)
                    gc.collect()

        ok_count = sum(1 for r in results if r["status"] == "ok")
        failed_count = sum(1 for r in results if r["status"] == "failed")
        no_design_count = sum(1 for r in results if r["status"] == "no_design")
        if ok_count == 0:
            failed_example = next((r.get("reason") for r in results if r["status"] == "failed" and r.get("reason")), None)
            detail = "No se pudo descargar ningún diseño."
            if failed_example:
                detail = f"{detail} Ejemplo: {failed_example}"
            elif no_design_count > 0:
                detail = "Los pedidos seleccionados no tienen diseños visibles para descargar."
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail,
            )

        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            filename="diseños-bulk.zip",
            headers={
                "X-Design-Results": str(ok_count),
                "X-Design-Failures": str(failed_count),
                "X-Design-No-Design": str(no_design_count),
            },
            background=BackgroundTask(_safe_remove, zip_path),
        )
    except Exception:
        _safe_remove(zip_path)
        raise


from pydantic import BaseModel as _BaseModel  # noqa: E402


class BulkDesignDownloadRequest(_BaseModel):
    order_ids: list[int]


@router.get("/{order_id}/delivery-prediction")
def get_delivery_prediction(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Predict delivery risk based on historical shipping performance."""
    from datetime import timedelta

    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipment).selectinload(Shipment.tracking_events))
        .where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=403, detail="Shop access denied")

    shipment = order.shipment
    if not shipment:
        return {"risk": "unknown", "risk_pct": 0, "message": "Sin envío creado", "estimated_delivery": None}

    if shipment.shipping_status == "delivered":
        return {"risk": "none", "risk_pct": 0, "message": "Entregado", "estimated_delivery": None}

    # Calculate days in transit
    created = shipment.created_at
    if created is None:
        return {"risk": "unknown", "risk_pct": 0, "message": "Sin fecha de envío", "estimated_delivery": None}

    days_in_transit = (datetime.now(timezone.utc) - created).days

    # Heuristic: based on typical CTT delivery windows
    # National: 1-3 days, International: 4-8 days
    is_international = False
    if order.shipping_country_code and order.shipping_country_code.upper() not in ("ES", "PT"):
        is_international = True

    expected_days = 8 if is_international else 3

    if days_in_transit <= expected_days:
        risk_pct = min(30, int((days_in_transit / expected_days) * 30))
        risk = "low"
        msg = f"En plazo ({days_in_transit}/{expected_days} días)"
    elif days_in_transit <= expected_days * 1.5:
        risk_pct = min(70, 30 + int(((days_in_transit - expected_days) / (expected_days * 0.5)) * 40))
        risk = "medium"
        msg = f"Atención: {days_in_transit} días en tránsito (esperado: {expected_days})"
    else:
        risk_pct = min(95, 70 + int(((days_in_transit - expected_days * 1.5) / expected_days) * 25))
        risk = "high"
        msg = f"Alto riesgo: {days_in_transit} días en tránsito (esperado: {expected_days})"

    estimated = created + timedelta(days=expected_days)

    return {
        "risk": risk,
        "risk_pct": risk_pct,
        "message": msg,
        "estimated_delivery": estimated.isoformat(),
        "days_in_transit": days_in_transit,
        "expected_days": expected_days,
    }
