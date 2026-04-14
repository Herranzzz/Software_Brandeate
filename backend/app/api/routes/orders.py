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
from typing import Literal
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
_DESIGN_MAX_ASSET_BYTES = 80 * 1024 * 1024  # 80 MB max per design file
# Rationale for 80 MB: 30×40 personalized designs at 300 DPI routinely come
# in as 40–60 MB JPEGs or PNGs with alpha. 15 MB was too restrictive and
# blocked real orders. The downloaded file lives on disk, and PIL's
# thumbnail cap (_CUT_MAX_DIM=2400) bounds peak RAM at ~50 MB per design
# regardless of source size, so 80 MB still fits a 512 MB host.
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

# --- Fixed print-sheet geometry ------------------------------------------
# The bulk-download "bleed" mode MUST produce files that always have the
# same canvas dimensions for a given variant, so batch-printing at
# fit-to-page comes out consistent. Dimensions are in millimetres; the
# final PNG is rendered at _PRINT_DPI so a full A4 / A3 sheet lands on a
# pixel-perfect canvas regardless of what size the source design was.
_PRINT_DPI = 200

_A4_W_MM = 210.0
_A4_H_MM = 297.0
_A3_W_MM = 297.0
_A3_H_MM = 420.0

# 18×24 layout: fits inside A4 portrait with the design anchored at the
# top-left corner. Dashed cut lines at the right and bottom edges of the
# design region.
_DESIGN_18X24_W_MM = 180.0
_DESIGN_18X24_H_MM = 240.0

# 30×40 layout: A3 portrait with a single dashed cut line 20 mm from the
# top edge. The 20 mm top strip is sacrificial (gets trimmed off). The
# design region fills the full A3 width below the cut line.
#
# A3 short edge is 297 mm, so the design width is technically 29.7 cm
# instead of a literal 30 cm — the 3 mm loss is within cutter tolerance
# and is invisible once the piece is framed. Using the full A3 width
# also means there is no right-side cut line to worry about.
_DESIGN_30X40_TOP_CUT_MM = 20.0
_DESIGN_30X40_W_MM = _A3_W_MM                         # 297
_DESIGN_30X40_H_MM = _A3_H_MM - _DESIGN_30X40_TOP_CUT_MM  # 400


def _mm_to_px(mm: float, dpi: int = _PRINT_DPI) -> int:
    return int(round(mm * dpi / 25.4))


def _detect_image_background_is_white(img, threshold: int = 235) -> bool:
    """True if all four corners of the image look near-white.

    Used by the bleed exporter to pick a scaling strategy: designs with a
    white background can be fit-preserved inside the safe cut region
    (any white border blends with the paper), but designs with a
    coloured / photographic background need to be scaled to cover the
    full sheet so the cut line falls on real artwork — otherwise a
    cutter drift of 1–2 mm leaves a visible white strip around the print.

    Detection is intentionally coarse: small patches at the four corners
    are averaged and compared against a brightness threshold. Corners
    are the right signal because print artwork that "has a background"
    almost always fills the whole canvas, whereas transparent PNGs and
    white-background JPEGs look clean at the corners.
    """
    w, h = img.size
    if w < 2 or h < 2:
        return True  # degenerate — fit-preserve is the safer default

    patch = max(1, min(16, w // 4, h // 4))
    boxes = [
        (0, 0, patch, patch),
        (w - patch, 0, w, patch),
        (0, h - patch, patch, h),
        (w - patch, h - patch, w, h),
    ]

    for box in boxes:
        region = img.crop(box)
        if region.mode != "RGB":
            converted = region.convert("RGB")
            region.close()
            region = converted
        pixels = list(region.getdata())
        region.close()
        if not pixels:
            return False
        total = 0
        for r, g, b in pixels:
            total += r + g + b
        avg_brightness = total / (len(pixels) * 3)
        if avg_brightness < threshold:
            return False
    return True


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


_CUT_MAX_DIM = 2400  # thumbnail cap — keeps peak RAM under ~30 MB per file


def _release_memory_to_os() -> None:
    """Force glibc malloc to return freed memory to the OS.

    Without this, Python's RSS keeps growing across many image-processing
    iterations even though gc.collect() frees the Python objects — glibc
    holds on to the freed arenas. malloc_trim(0) forces the release.
    No-op on non-glibc systems (macOS, BSDs).
    """
    import gc
    gc.collect()
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6", use_errno=False)
        libc.malloc_trim(0)
    except Exception:
        pass  # not glibc — nothing to do
_CUT_LINE_COLOR = (229, 57, 53)  # red matching previous reportlab color
_CUT_LINE_WIDTH = 3
_CUT_DASH = 18
_CUT_GAP = 10


def _draw_dashed_line_h(draw: object, x0: int, x1: int, y: int,
                         color: tuple, width: int, dash: int, gap: int) -> None:
    """Draw a horizontal dashed line using PIL ImageDraw."""
    x = x0
    while x < x1:
        end = min(x + dash, x1)
        draw.line([(x, y), (end, y)], fill=color, width=width)  # type: ignore[union-attr]
        x = end + gap


def _draw_dashed_line_v(draw: object, y0: int, y1: int, x: int,
                         color: tuple, width: int, dash: int, gap: int) -> None:
    """Draw a vertical dashed line using PIL ImageDraw."""
    y = y0
    while y < y1:
        end = min(y + dash, y1)
        draw.line([(x, y), (x, end)], fill=color, width=width)  # type: ignore[union-attr]
        y = end + gap


def _add_cut_lines_to_image(image_path: str, output_path: str, print_variant: str) -> None:
    """Render the design onto a fixed-size A4 (18×24) or A3 (30×40) sheet.

    Core guarantee: every PNG produced for a given variant has IDENTICAL
    canvas pixel dimensions, so when an operator batch-prints at "fit to
    page", every design comes out at the exact same physical size.

    Layouts:

      18×24 on A4 portrait (210×297 mm)
        - Design region 180×240 mm anchored at the top-left of the sheet.
        - Dashed cut lines at the right edge and bottom edge of the region.

      30×40 on A3 portrait (297×420 mm)
        - 20 mm sacrificial strip along the top edge of the sheet.
        - Design region fills 297×400 mm below that strip
          (anchored at x=0, y=20 mm, extending to the bottom-right corner).
        - ONE dashed cut line — horizontal, at y=20 mm, spanning the
          full width of the sheet. No right or bottom cut lines; the
          design goes all the way to the paper edge on those sides.

    Pipeline:
      1. Open + thumbnail-cap the source to bound peak memory.
      2. Flatten any transparency onto a white background.
      3. If the source is landscape, rotate it 90° so every design lands
         on a portrait sheet the same way.
      4. Detect whether the background is white and pick a scaling
         strategy:
           - white bg → fit-preserve inside the design region (any
             white gap blends with the paper after trimming)
           - non-white bg → scale to cover the full sheet so the
             artwork bleeds past the cut line and a 1–2 mm cutter
             drift never leaves a white strip
      5. Paste onto a pristine A4 / A3 white canvas at _PRINT_DPI.
         Any overflow past the sheet edges is clipped so the canvas
         size stays fixed.
      6. Draw the variant's dashed cut lines and alignment ticks.

    Peak memory: source thumb (~17 MB) + resized (~20 MB) + A3 canvas
    (~23 MB) ≈ 60 MB, within a 512 MB host's budget for sequential work.
    """
    import gc
    from PIL import Image as PilImage, ImageDraw

    img = None
    resized = None
    canvas = None
    try:
        img = PilImage.open(image_path)
        img.thumbnail((_CUT_MAX_DIM, _CUT_MAX_DIM), PilImage.LANCZOS)

        # Flatten transparency onto white. Without this, pasting RGBA
        # onto an RGB canvas leaves transparent pixels black.
        has_transparency = (
            img.mode in ("RGBA", "LA")
            or (img.mode == "P" and "transparency" in img.info)
        )
        if has_transparency:
            rgba = img.convert("RGBA")
            flattened = PilImage.new("RGB", rgba.size, (255, 255, 255))
            flattened.paste(rgba, mask=rgba.split()[3])
            if rgba is not img:
                rgba.close()
            img.close()
            img = flattened
        elif img.mode != "RGB":
            converted = img.convert("RGB")
            img.close()
            img = converted

        # Always orient portrait. If the operator uploaded a landscape
        # design, we rotate 90° counterclockwise so it fits the portrait
        # sheet consistently with the other files in the batch.
        if img.width > img.height:
            rotated = img.rotate(90, expand=True)
            img.close()
            img = rotated

        # Paper + design region geometry for this variant. `region_x/y`
        # is the top-left corner of the design area on the sheet in mm;
        # `region_w/h` is its size. 18×24 anchors the region at (0,0);
        # 30×40 anchors it below a 20 mm top strip.
        if print_variant == "30x40":
            paper_w_mm = _A3_W_MM
            paper_h_mm = _A3_H_MM
            region_x_mm = 0.0
            region_y_mm = _DESIGN_30X40_TOP_CUT_MM
            region_w_mm = _DESIGN_30X40_W_MM
            region_h_mm = _DESIGN_30X40_H_MM
        elif print_variant == "18x24":
            paper_w_mm = _A4_W_MM
            paper_h_mm = _A4_H_MM
            region_x_mm = 0.0
            region_y_mm = 0.0
            region_w_mm = _DESIGN_18X24_W_MM
            region_h_mm = _DESIGN_18X24_H_MM
        else:
            # Unknown variant — save the source as PNG and bail.
            img.save(output_path, "PNG", optimize=False)
            return

        canvas_w = _mm_to_px(paper_w_mm)
        canvas_h = _mm_to_px(paper_h_mm)
        region_x = _mm_to_px(region_x_mm)
        region_y = _mm_to_px(region_y_mm)
        region_w = _mm_to_px(region_w_mm)
        region_h = _mm_to_px(region_h_mm)

        # Scaling strategy per variant:
        #
        # * 18×24 white background — fit-preserve inside the 180×240 mm
        #   region and paste flush at the top-left corner. Any white gap
        #   between the design and the region edge blends with the paper.
        #
        # * 18×24 non-white background — cover-scale to fill the REGION
        #   completely, center-cropped, then pasted at the region origin.
        #   The 18×24 cut box must never show white inside it on coloured
        #   designs (some content gets cropped — that's the trade-off the
        #   user accepted). The image is clipped to the region only, so
        #   it does NOT bleed into the right/bottom whitespace where the
        #   cut lines sit.
        #
        # * 30×40 white background — fit-preserve inside the region below
        #   the 20 mm top strip.
        #
        # * 30×40 non-white background — cover-scale across the full A3
        #   so the dashed cut line is drawn on top of actual artwork.
        #   Protects against a drifted guillotine leaving a white seam.
        is_white_bg = _detect_image_background_is_white(img)

        if print_variant == "18x24" and not is_white_bg:
            # Cover-scale to the region (not the canvas) and crop.
            scale = max(region_w / img.width, region_h / img.height)
        elif is_white_bg:
            scale = min(region_w / img.width, region_h / img.height)
        else:
            # 30×40 non-white: cover the full A3 sheet.
            scale = max(canvas_w / img.width, canvas_h / img.height)

        fit_w = max(1, int(round(img.width * scale)))
        fit_h = max(1, int(round(img.height * scale)))
        resized = img.resize((fit_w, fit_h), PilImage.LANCZOS)
        img.close()
        img = None

        # For the 18×24 cover-scaled case we must crop the resized image
        # down to exactly the region size so it doesn't spill over the
        # cut lines into the surrounding whitespace.
        #
        # Vertical bias: 60/40 in favour of the bottom — i.e. we take
        # 50% more pixels off the top than off the bottom. Operators
        # routinely overlay text near the bottom of the design (names,
        # dates), so biasing the crop downward keeps that text visible
        # at the cost of slightly more aggressive trimming up top.
        # Horizontal axis stays centered.
        if print_variant == "18x24" and not is_white_bg:
            excess_w = max(0, resized.width - region_w)
            excess_h = max(0, resized.height - region_h)
            crop_left = excess_w // 2
            crop_top = int(round(excess_h * 0.6))
            cropped = resized.crop(
                (crop_left, crop_top, crop_left + region_w, crop_top + region_h)
            )
            resized.close()
            resized = cropped
            paste_x, paste_y = region_x, region_y
        elif is_white_bg:
            paste_x, paste_y = region_x, region_y
        else:
            # 30×40 non-white: paste at canvas origin so the cover-scaled
            # artwork bleeds across the whole sheet.
            paste_x, paste_y = 0, 0

        # Pristine A4 / A3 white canvas at _PRINT_DPI.
        canvas = PilImage.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
        canvas.paste(resized, (paste_x, paste_y))
        resized.close()
        resized = None

        draw = ImageDraw.Draw(canvas)
        tick = _mm_to_px(4)

        if print_variant == "30x40":
            # Single dashed cut line across the full width of the sheet,
            # 20 mm from the top. Everything above it is the sacrificial
            # strip the operator trims off.
            _draw_dashed_line_h(
                draw, 0, canvas_w, region_y,
                _CUT_LINE_COLOR, _CUT_LINE_WIDTH, _CUT_DASH, _CUT_GAP,
            )
            # Small solid ticks at both ends of the cut line, pointing up
            # into the strip — makes it easy to align a guillotine blade
            # by eye without having to trace the dashed line across the
            # whole sheet.
            draw.line(
                [(0, region_y), (0, max(0, region_y - tick))],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )
            draw.line(
                [(canvas_w - 1, region_y), (canvas_w - 1, max(0, region_y - tick))],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )
        else:
            # 18×24: design anchored top-left, dashed cut lines at the
            # right and bottom edges of the 180×240 region.
            _draw_dashed_line_v(
                draw, 0, region_h, region_w,
                _CUT_LINE_COLOR, _CUT_LINE_WIDTH, _CUT_DASH, _CUT_GAP,
            )
            _draw_dashed_line_h(
                draw, 0, region_w, region_h,
                _CUT_LINE_COLOR, _CUT_LINE_WIDTH, _CUT_DASH, _CUT_GAP,
            )
            # Solid corner ticks so the cutter can line up the blade at
            # the three outside corners that aren't the sheet corner.
            draw.line(
                [(region_w, 0), (min(canvas_w - 1, region_w + tick), 0)],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )
            draw.line(
                [(0, region_h), (0, min(canvas_h - 1, region_h + tick))],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )
            draw.line(
                [(region_w, region_h), (min(canvas_w - 1, region_w + tick), region_h)],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )
            draw.line(
                [(region_w, region_h), (region_w, min(canvas_h - 1, region_h + tick))],
                fill=_CUT_LINE_COLOR, width=_CUT_LINE_WIDTH,
            )

        canvas.save(output_path, "PNG", optimize=False)
    finally:
        if canvas is not None:
            try:
                canvas.close()
            except Exception:
                pass
        if resized is not None:
            try:
                resized.close()
            except Exception:
                pass
        if img is not None:
            try:
                img.close()
            except Exception:
                pass
        del canvas, resized, img
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


def _flatten_alpha_if_needed(image_path: str) -> str:
    """If the image has transparency, flatten it onto a WHITE background
    and return the new path (the original is deleted).  Otherwise return
    the original path untouched.

    Memory-safe: uses lazy Image.open() to check mode without decoding
    pixels, and thumbnail() to cap resolution before flattening.
    """
    import gc
    try:
        from PIL import Image as PilImage
    except Exception:
        return image_path  # PIL not available — pass through

    try:
        with PilImage.open(image_path) as probe:
            mode = probe.mode
            has_alpha = (
                mode in ("RGBA", "LA")
                or (mode == "P" and "transparency" in probe.info)
            )
        if not has_alpha:
            return image_path
    except Exception:
        return image_path  # can't read — let downstream handle it

    img = None
    flattened = None
    out_fd, out_path = tempfile.mkstemp(prefix="flat-", suffix=".png")
    os.close(out_fd)
    try:
        img = PilImage.open(image_path)
        img.thumbnail((_CUT_MAX_DIM, _CUT_MAX_DIM), PilImage.LANCZOS)
        rgba = img.convert("RGBA")
        flattened = PilImage.new("RGB", rgba.size, (255, 255, 255))
        flattened.paste(rgba, mask=rgba.split()[3])
        if rgba is not img:
            rgba.close()
        flattened.save(out_path, "PNG", optimize=False)
        _safe_remove(image_path)
        return out_path
    except Exception:
        _safe_remove(out_path)
        return image_path
    finally:
        if flattened is not None:
            try:
                flattened.close()
            except Exception:
                pass
        if img is not None:
            try:
                img.close()
            except Exception:
                pass
        del flattened, img
        gc.collect()


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
            mode = str(job.get("mode") or "bleed")
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
        # No hard cap on file count — process all selected files.
        # Memory is kept bounded by sequential processing, thumbnail()
        # capping per-file RAM, gc.collect() + malloc_trim() between files.

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
                    print_variant = current_job.get("print_variant")
                    ext = current_job["url_ext"] or fetched_ext or ".bin"

                    if mode == "raw":
                        # Raw mode: ship the file exactly as downloaded — no
                        # cut lines, no alpha flattening, no resizing. This
                        # is the escape hatch for when the automatic bleed
                        # transformations aren't what the operator wants.
                        suffix = ""
                    else:
                        # Bleed mode (default): if this is a print variant
                        # (30x40 / 18x24), add cut lines using PIL with
                        # thumbnail (peak ~40 MB, safe for 512 MB hosts).
                        # Output is always PNG.
                        if print_variant:
                            cut_fd, cut_path = tempfile.mkstemp(prefix="cut-", suffix=".png")
                            os.close(cut_fd)
                            try:
                                _add_cut_lines_to_image(temp_path, cut_path, print_variant)
                                _safe_remove(temp_path)
                                temp_path = cut_path
                                ext = ".png"
                            except Exception:
                                # If cut-line generation fails, fall back to raw image
                                _safe_remove(cut_path)
                        else:
                            # Flatten transparency onto white if needed (so PNGs
                            # with transparent backgrounds don't appear black).
                            flattened_path = _flatten_alpha_if_needed(temp_path)
                            if flattened_path != temp_path:
                                temp_path = flattened_path
                                ext = ".png"
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
                    _release_memory_to_os()
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
        "mode": payload.mode,
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
                    print_variant = job.get("print_variant")
                    ext = job["url_ext"] or fetched_ext or ".bin"

                    if print_variant:
                        cut_fd, cut_path = tempfile.mkstemp(prefix="cut-", suffix=".png")
                        os.close(cut_fd)
                        try:
                            _add_cut_lines_to_image(temp_path, cut_path, print_variant)
                            _safe_remove(temp_path)
                            temp_path = cut_path
                            ext = ".png"
                        except Exception:
                            _safe_remove(cut_path)
                    else:
                        flattened_path = _flatten_alpha_if_needed(temp_path)
                        if flattened_path != temp_path:
                            temp_path = flattened_path
                            ext = ".png"

                    suffix = f" [{print_variant}]" if print_variant else ""
                    filename = _unique_name(job["base"] + suffix, ext, used_names)
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
                    _release_memory_to_os()

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
    mode: Literal["raw", "bleed"] = "bleed"


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
        .options(selectinload(Order.shipment).selectinload(Shipment.events))
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
