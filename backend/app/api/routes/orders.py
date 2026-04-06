import csv
import io
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
import sqlalchemy as sa
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_accessible_shop_ids, get_db, resolve_shop_scope
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
)
from app.schemas.incident import IncidentRead
from app.schemas.order import (
    OrderCreate,
    OrderDetailRead,
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
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.orders import infer_order_is_personalized, sync_order_item_design_statuses


router = APIRouter(prefix="/orders", tags=["orders"])


def _order_query():
    return select(Order).options(
        selectinload(Order.shop),
        selectinload(Order.items),
        selectinload(Order.incidents),
        selectinload(Order.shipment).selectinload(Shipment.events),
    )


def _order_detail_query():
    return _order_query().options(selectinload(Order.automation_events))


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
                Order.items.any(OrderItem.sku.ilike(term)),
                Order.items.any(OrderItem.name.ilike(term)),
                Order.items.any(OrderItem.title.ilike(term)),
                Order.shipment.has(Shipment.tracking_number.ilike(term)),
            )
        )
    return query


@router.get("", response_model=list[OrderRead])
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
    page: int | None = None,
    per_page: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Order]:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
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

    # Contar total antes de paginar para X-Total-Count
    count_query = _build_order_filters(
        select(func.count()).select_from(Order),
        **filter_kwargs,
    )
    total_count = db.scalar(count_query) or 0
    response.headers["X-Total-Count"] = str(total_count)

    data_query = _build_order_filters(
        _order_query().order_by(Order.created_at.desc(), Order.id.desc()),
        **filter_kwargs,
    )
    if per_page is not None:
        safe_per_page = max(1, min(per_page, 500))
        safe_page = max(page or 1, 1)
        data_query = data_query.limit(safe_per_page).offset((safe_page - 1) * safe_per_page)

    orders = list(db.scalars(data_query))
    _enrich_order_variant_titles(db, orders)
    return orders


@router.post("/bulk/production-status", response_model=list[OrderRead])
def bulk_update_order_production_status(
    payload: OrderBulkProductionStatusUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Order]:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    for order in orders:
        order.production_status = payload.production_status
        evaluate_order_automation_rules(db=db, order=order, source="bulk_production_status")
    db.commit()
    return list(
        db.scalars(_order_query().where(Order.id.in_(payload.order_ids)).order_by(Order.created_at.desc(), Order.id.desc()))
    )


@router.post("/bulk/priority", response_model=list[OrderRead])
def bulk_update_order_priority(
    payload: OrderBulkPriorityUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Order]:
    orders = _load_target_orders(db, payload.order_ids, accessible_shop_ids)
    for order in orders:
        order.priority = payload.priority
    db.commit()
    return list(
        db.scalars(_order_query().where(Order.id.in_(payload.order_ids)).order_by(Order.created_at.desc(), Order.id.desc()))
    )


@router.post("/bulk/incidents", response_model=list[IncidentRead], status_code=status.HTTP_201_CREATED)
def bulk_create_order_incidents(
    payload: OrderBulkIncidentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
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
        )
        db.add(incident)
        incidents.append(incident)
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
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    order.status = payload.status
    evaluate_order_automation_rules(db=db, order=order, source="order_status_update")
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}/production-status", response_model=OrderDetailRead)
def update_order_production_status(
    order_id: int,
    payload: OrderProductionStatusUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    order.production_status = payload.production_status
    evaluate_order_automation_rules(db=db, order=order, source="order_production_update")
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}/priority", response_model=OrderDetailRead)
def update_order_priority(
    order_id: int,
    payload: OrderPriorityUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    order.priority = payload.priority
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))


@router.patch("/{order_id}", response_model=OrderDetailRead)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(order, key, value)

    evaluate_order_automation_rules(db=db, order=order, source="order_update")
    db.commit()
    return db.scalar(_order_detail_query().where(Order.id == order_id))
