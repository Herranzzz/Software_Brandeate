from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import false, func, select
from sqlalchemy.orm import Session, load_only, selectinload

from app.models import Incident, IncidentStatus, Order, OrderItem, Shipment, Shop, ShopIntegration, TrackingEvent


UTC = timezone.utc
SENT_SLA_HOURS = 48
DELIVERED_SLA_HOURS = 72
TRACKING_STALLED_HOURS = 72
PREPARED_NOT_COLLECTED_HOURS = 24


@dataclass(slots=True)
class AnalyticsFilters:
    date_from: date | None = None
    date_to: date | None = None
    shop_id: int | None = None
    channel: str | None = None
    is_personalized: bool | None = None
    status: str | None = None
    production_status: str | None = None
    carrier: str | None = None


def _enum_value(value: Any) -> str | None:
    if value is None:
        return None
    return getattr(value, "value", value)


def _safe_text(value: Any, fallback: str = "Sin dato") -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _hours_between(start: datetime | None, end: datetime | None) -> float | None:
    normalized_start = _as_utc(start)
    normalized_end = _as_utc(end)
    if normalized_start is None or normalized_end is None:
        return None
    delta = (normalized_end - normalized_start).total_seconds() / 3600
    return delta if delta >= 0 else None


def _start_of_day(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=UTC)


def _end_of_day(value: date) -> datetime:
    return datetime.combine(value, time.max, tzinfo=UTC)


def _latest_event(shipment: Shipment | None) -> TrackingEvent | None:
    if shipment is None or not shipment.events:
        return None
    return max(shipment.events, key=lambda event: (_as_utc(event.occurred_at), event.id))


def _delivered_event(shipment: Shipment | None) -> TrackingEvent | None:
    if shipment is None:
        return None
    delivered_events = [event for event in shipment.events if _safe_text(event.status_norm, "").lower() == "delivered"]
    if not delivered_events:
        return None
    return max(delivered_events, key=lambda event: (_as_utc(event.occurred_at), event.id))


def _first_real_carrier_event(shipment: Shipment | None) -> TrackingEvent | None:
    if shipment is None:
        return None
    carrier_events = [
        event
        for event in shipment.events
        if _safe_text(event.status_norm, "").lower() not in {"", "label_created"}
    ]
    if not carrier_events:
        return None
    return min(carrier_events, key=lambda event: (_as_utc(event.occurred_at), event.id))


def _latest_status_norm(shipment: Shipment | None) -> str:
    latest = _latest_event(shipment)
    return _safe_text(latest.status_norm if latest else "", "").lower()


def _has_shipping_exception(order: Order) -> bool:
    if _enum_value(order.status) == "exception":
        return True
    latest_norm = _latest_status_norm(order.shipment)
    if latest_norm == "exception":
        return True
    return any(
        _enum_value(incident.status) != IncidentStatus.resolved.value
        and _safe_text(_enum_value(incident.type), "").lower() == "shipping_exception"
        for incident in order.incidents
    )


def _shipment_stage(order: Order) -> str:
    if _has_shipping_exception(order):
        return "exception"
    if order.shipment is None:
        return "pending"
    latest_norm = _latest_status_norm(order.shipment)
    if latest_norm == "delivered":
        return "delivered"
    if latest_norm == "out_for_delivery":
        return "out_for_delivery"
    if latest_norm == "in_transit":
        return "in_transit"
    if _first_real_carrier_event(order.shipment) is not None:
        return "picked_up"
    return "prepared"


def _is_without_tracking(order: Order) -> bool:
    if order.shipment is None:
        return False
    tracking_number = _safe_text(order.shipment.tracking_number, "")
    return not tracking_number or len(order.shipment.events or []) == 0


def _is_prepared_not_collected(order: Order, reference_time: datetime) -> bool:
    if order.shipment is None:
        return False
    if _first_real_carrier_event(order.shipment) is not None:
        return False
    created_at = _as_utc(order.shipment.created_at)
    if created_at is None:
        return False
    return (reference_time - created_at) >= timedelta(hours=PREPARED_NOT_COLLECTED_HOURS)


def _is_outside_delivery_sla(order: Order, reference_time: datetime) -> bool:
    delivered_event = _delivered_event(order.shipment)
    end_time = delivered_event.occurred_at if delivered_event else reference_time
    elapsed = _hours_between(order.created_at, end_time)
    if elapsed is None:
        return False
    return elapsed > DELIVERED_SLA_HOURS


def _stage_label(stage: str) -> str:
    return {
        "pending": "Pendiente",
        "prepared": "Preparado",
        "picked_up": "Recogido",
        "in_transit": "En tránsito",
        "out_for_delivery": "En reparto",
        "delivered": "Entregado",
        "exception": "Incidencia",
    }.get(stage, "Pendiente")


def _latest_event_label(order: Order) -> str:
    latest_norm = _latest_status_norm(order.shipment)
    if latest_norm:
        return _stage_label(_shipment_stage(order))
    if order.shipment is not None:
        return "Etiqueta creada"
    return "Sin shipment"


def _has_design_link(order: Order) -> bool:
    return any(bool(item.design_link) for item in order.items)


def _has_personalization_assets(order: Order) -> bool:
    for item in order.items:
        assets = item.personalization_assets_json
        if isinstance(assets, list) and len(assets) > 0:
            return True
        if isinstance(assets, dict) and len(assets) > 0:
            return True
    return False


def _is_blocked(order: Order) -> bool:
    if _enum_value(order.status) == "exception":
        return True
    return any(_enum_value(incident.status) != IncidentStatus.resolved.value for incident in order.incidents)


def _is_tracking_stalled(order: Order, reference_time: datetime) -> bool:
    latest = _latest_event(order.shipment)
    if latest is None:
        return False
    if _safe_text(latest.status_norm, "").lower() in {"delivered", "exception"}:
        return False
    latest_occurred_at = _as_utc(latest.occurred_at)
    if latest_occurred_at is None:
        return False
    return (reference_time - latest_occurred_at) >= timedelta(hours=TRACKING_STALLED_HOURS)


def _effective_tracking_status(order: Order, order_status_val: str) -> str:
    """For shipped/ready_to_ship orders resolve a finer-grained status from
    the latest tracking event so the donut distinguishes:
      - label_created  → label generated, carrier hasn't scanned yet
      - in_transit     → carrier has the package (any real scan ≠ label_created)
      - out_for_delivery → out for delivery
    Any status that is NOT one of those three falls back to 'in_transit'
    because any carrier event means the carrier already has the parcel."""
    if order_status_val not in ("shipped", "ready_to_ship"):
        return order_status_val
    if not order.shipment:
        return order_status_val
    latest = _latest_event(order.shipment)
    if latest is None:
        # Shipment exists but no tracking events yet → still at label stage
        return "label_created"
    norm = _safe_text(latest.status_norm, "").lower()
    if norm == "out_for_delivery":
        return "out_for_delivery"
    if norm in ("in_transit", "pickup_available", "attempted_delivery"):
        return "in_transit"
    if norm in ("label_created", ""):
        return "label_created"
    # Any other carrier event (unknown norm) = carrier has the package = in_transit
    return "in_transit"


def _carrier_for_order(order: Order) -> str | None:
    if order.shipment is None or not order.shipment.carrier:
        return None
    return order.shipment.carrier.strip()


def _order_matches_filters(order: Order, filters: AnalyticsFilters, channel_shop_ids: set[int] | None) -> bool:
    if filters.shop_id is not None and order.shop_id != filters.shop_id:
        return False
    if filters.is_personalized is not None and order.is_personalized is not filters.is_personalized:
        return False
    if filters.status is not None and _enum_value(order.status) != filters.status:
        return False
    if filters.production_status is not None and _enum_value(order.production_status) != filters.production_status:
        return False
    if filters.carrier is not None and (_carrier_for_order(order) or "").lower() != filters.carrier.lower():
        return False
    if filters.channel:
        if filters.channel != "shopify":
            return False
        if channel_shop_ids is None or order.shop_id not in channel_shop_ids:
            return False
    created_at = _as_utc(order.created_at)
    if filters.date_from is not None and created_at is not None and created_at < _start_of_day(filters.date_from):
        return False
    if filters.date_to is not None and created_at is not None and created_at > _end_of_day(filters.date_to):
        return False
    return True


def _apply_query_filters(
    *,
    base_query,
    filters: AnalyticsFilters,
    channel_shop_ids: set[int] | None,
):
    query = base_query
    if filters.shop_id is not None:
        query = query.where(Order.shop_id == filters.shop_id)
    if filters.is_personalized is not None:
        query = query.where(Order.is_personalized.is_(filters.is_personalized))
    if filters.status is not None:
        query = query.where(Order.status == filters.status)
    if filters.production_status is not None:
        query = query.where(Order.production_status == filters.production_status)
    if filters.carrier is not None and filters.carrier.strip():
        normalized_carrier = filters.carrier.strip().lower()
        query = query.where(
            Order.shipment.has(func.lower(func.trim(func.coalesce(Shipment.carrier, ""))) == normalized_carrier)
        )
    if filters.channel:
        if filters.channel == "shopify":
            if channel_shop_ids:
                query = query.where(Order.shop_id.in_(channel_shop_ids))
            else:
                query = query.where(false())
        else:
            query = query.where(false())
    if filters.date_from is not None:
        query = query.where(Order.created_at >= _start_of_day(filters.date_from))
    if filters.date_to is not None:
        query = query.where(Order.created_at <= _end_of_day(filters.date_to))
    return query


def _percentage(value: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round((value / total) * 100, 1)


def build_analytics_overview(
    db: Session,
    filters: AnalyticsFilters,
    accessible_shop_ids: set[int] | None,
) -> dict[str, Any]:
    integrations = list(
        db.scalars(
            select(ShopIntegration).where(
                ShopIntegration.provider == "shopify",
                ShopIntegration.is_active.is_(True),
            )
        )
    )
    channel_shop_ids = {integration.shop_id for integration in integrations}

    query = (
        select(Order)
        .options(
            load_only(
                Order.id,
                Order.shop_id,
                Order.external_id,
                Order.status,
                Order.production_status,
                Order.is_personalized,
                Order.customer_name,
                Order.created_at,
            ),
            selectinload(Order.shop).load_only(Shop.id, Shop.name),
            selectinload(Order.items).load_only(
                OrderItem.id,
                OrderItem.order_id,
                OrderItem.sku,
                OrderItem.name,
                OrderItem.quantity,
                OrderItem.design_link,
                OrderItem.design_status,
                OrderItem.personalization_assets_json,
            ),
            selectinload(Order.shipment)
            .load_only(
                Shipment.id,
                Shipment.order_id,
                Shipment.carrier,
                Shipment.tracking_number,
                Shipment.shipping_status,
                Shipment.created_at,
            )
            .selectinload(Shipment.events)
            .load_only(
                TrackingEvent.id,
                TrackingEvent.shipment_id,
                TrackingEvent.status_norm,
                TrackingEvent.status_raw,
                TrackingEvent.occurred_at,
            ),
            selectinload(Order.incidents).load_only(
                Incident.id,
                Incident.order_id,
                Incident.status,
                Incident.type,
                Incident.updated_at,
            ),
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
    )

    if accessible_shop_ids is not None:
        query = query.where(Order.shop_id.in_(accessible_shop_ids))

    query = _apply_query_filters(
        base_query=query,
        filters=filters,
        channel_shop_ids=channel_shop_ids,
    )

    orders = list(db.scalars(query))

    now = datetime.now(UTC)
    today_key = now.date().isoformat()
    week_start = now.date() - timedelta(days=now.weekday())
    month_start = now.date().replace(day=1)

    total_orders = len(orders)
    personalized_orders = [order for order in orders if order.is_personalized]
    standard_orders = [order for order in orders if not order.is_personalized]
    open_incidents = [
        incident
        for order in orders
        for incident in order.incidents
        if _enum_value(incident.status) != IncidentStatus.resolved.value
    ]
    blocked_orders = [order for order in orders if _is_blocked(order)]
    orders_without_shipment = [order for order in orders if order.shipment is None]
    orders_without_tracking = [order for order in orders if _is_without_tracking(order)]
    prepared_not_collected_orders = [order for order in orders if _is_prepared_not_collected(order, now)]
    outside_sla_orders = [order for order in orders if _is_outside_delivery_sla(order, now)]
    stalled_tracking_orders = [order for order in orders if _is_tracking_stalled(order, now)]

    created_today = [order for order in orders if (_as_utc(order.created_at) or now).date().isoformat() == today_key]
    created_this_week = [order for order in orders if (_as_utc(order.created_at) or now).date() >= week_start]
    created_this_month = [order for order in orders if (_as_utc(order.created_at) or now).date() >= month_start]

    shipped_orders = [order for order in orders if _enum_value(order.status) == "shipped"]
    stage_buckets: dict[str, list[Order]] = defaultdict(list)
    for order in orders:
        stage_buckets[_shipment_stage(order)].append(order)
    pending_orders = stage_buckets["pending"]
    prepared_orders = stage_buckets["prepared"]
    picked_up_orders = stage_buckets["picked_up"]
    in_transit_orders = stage_buckets["in_transit"]
    out_for_delivery_orders = stage_buckets["out_for_delivery"]
    delivered_orders = stage_buckets["delivered"]
    exception_orders = stage_buckets["exception"]

    sent_sla_hours = [
        hours
        for order in orders
        if (hours := _hours_between(order.created_at, order.shipment.created_at if order.shipment else None)) is not None
    ]
    delivery_hours = [
        hours
        for order in orders
        if (hours := _hours_between(order.shipment.created_at if order.shipment else None, _delivered_event(order.shipment).occurred_at if _delivered_event(order.shipment) else None)) is not None
    ]

    personalized_prep_hours = [
        hours
        for order in personalized_orders
        if (hours := _hours_between(order.created_at, order.shipment.created_at if order.shipment else None)) is not None
    ]

    pending_assets_orders = [
        order
        for order in personalized_orders
        if not _has_design_link(order) and not _has_personalization_assets(order)
    ]
    pending_review_orders = [
        order
        for order in personalized_orders
        if _has_design_link(order) and _enum_value(order.production_status) == "pending_personalization"
    ]
    design_link_available_orders = [order for order in personalized_orders if _has_design_link(order)]
    personalized_blocked_orders = [order for order in personalized_orders if _is_blocked(order)]

    # Flow metrics
    orders_with_shipment = [o for o in orders if o.shipment is not None]

    first_transit_times = []
    first_pickup_times = []
    pickup_to_delivery_times = []
    for order in orders_with_shipment:
        first_pickup = _first_real_carrier_event(order.shipment)
        if first_pickup is not None:
            hours = _hours_between(order.shipment.created_at, first_pickup.occurred_at)
            if hours is not None and hours >= 0:
                first_pickup_times.append(hours)
        transit_events = [
            e for e in (order.shipment.events or [])
            if _safe_text(e.status_norm, "").lower() in {"in_transit", "out_for_delivery"}
        ]
        if transit_events:
            first_transit = min(transit_events, key=lambda e: (_as_utc(e.occurred_at), e.id))
            hours = _hours_between(order.shipment.created_at, first_transit.occurred_at)
            if hours is not None and hours >= 0:
                first_transit_times.append(hours)
        delivered_ev = _delivered_event(order.shipment)
        if first_pickup is not None and delivered_ev is not None:
            hours = _hours_between(first_pickup.occurred_at, delivered_ev.occurred_at)
            if hours is not None and hours >= 0:
                pickup_to_delivery_times.append(hours)

    total_hours_list = []
    for order in orders:
        delivered_ev = _delivered_event(order.shipment)
        hours = _hours_between(order.created_at, delivered_ev.occurred_at if delivered_ev else None)
        if hours is not None and hours >= 0:
            total_hours_list.append(hours)

    orders_by_day_counter: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "personalized": 0, "standard": 0, "delivered": 0, "exception": 0})
    shipping_performance_by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "created_shipments": 0,
            "delivered_orders": 0,
            "exception_orders": 0,
            "on_time_hits": 0,
            "on_time_total": 0,
            "avg_transit_hours": [],
            "avg_total_hours": [],
        }
    )
    aging_buckets = {"bucket_0_24": 0, "bucket_24_48": 0, "bucket_48_72": 0, "bucket_72_plus": 0}
    status_counter: Counter[str] = Counter()
    shipping_status_counter: Counter[str] = Counter()
    shop_counter: Counter[tuple[int, str]] = Counter()
    incident_type_counter: Counter[str] = Counter()
    personalized_breakdown = {
        "personalized": len(personalized_orders),
        "standard": len(standard_orders),
    }

    sku_totals: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"quantity": 0, "orders": 0})
    carrier_buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"shipments": 0, "delivered_orders": 0, "delivery_hours": [], "incident_orders": 0}
    )
    top_shop_buckets: dict[tuple[int, str], dict[str, int]] = defaultdict(
        lambda: {"orders": 0, "personalized_orders": 0, "delivered_orders": 0}
    )
    delayed_orders: list[dict[str, Any]] = []
    attention_shipments: list[dict[str, Any]] = []

    for order in orders:
        created_at = _as_utc(order.created_at)
        date_key = created_at.date().isoformat() if created_at else today_key
        orders_by_day_counter[date_key]["total"] += 1
        orders_by_day_counter[date_key]["personalized" if order.is_personalized else "standard"] += 1

        order_status_val = _safe_text(_enum_value(order.status), "unknown")
        if order_status_val == "delivered":
            orders_by_day_counter[date_key]["delivered"] += 1
        if order_status_val == "exception" or any(
            _enum_value(inc.status) != IncidentStatus.resolved.value for inc in order.incidents
        ):
            orders_by_day_counter[date_key]["exception"] += 1

        # Aging buckets: classify active shipments by hours since last tracking update
        if order.shipment and order_status_val not in ("delivered", "exception"):
            latest_ev = _latest_event(order.shipment)
            last_update = _as_utc(latest_ev.occurred_at if latest_ev else order.shipment.created_at)
            if last_update is not None:
                age_h = (now - last_update).total_seconds() / 3600
                if age_h < 24:
                    aging_buckets["bucket_0_24"] += 1
                elif age_h < 48:
                    aging_buckets["bucket_24_48"] += 1
                elif age_h < 72:
                    aging_buckets["bucket_48_72"] += 1
                else:
                    aging_buckets["bucket_72_plus"] += 1

        if order.shipment and (shipment_created_at := _as_utc(order.shipment.created_at)) is not None:
            shipping_performance_by_day[shipment_created_at.date().isoformat()]["created_shipments"] += 1

        delivered_event = _delivered_event(order.shipment)
        transit_hours = _hours_between(order.shipment.created_at if order.shipment else None, delivered_event.occurred_at if delivered_event else None)
        total_delivery_hours = _hours_between(order.created_at, delivered_event.occurred_at if delivered_event else None)
        if delivered_event is not None:
            delivery_day = _as_utc(delivered_event.occurred_at)
            delivery_key = delivery_day.date().isoformat() if delivery_day else date_key
            shipping_performance_by_day[delivery_key]["delivered_orders"] += 1
            shipping_performance_by_day[delivery_key]["on_time_total"] += 1
            if total_delivery_hours is not None and total_delivery_hours <= DELIVERED_SLA_HOURS:
                shipping_performance_by_day[delivery_key]["on_time_hits"] += 1
            if transit_hours is not None:
                shipping_performance_by_day[delivery_key]["avg_transit_hours"].append(transit_hours)
            if total_delivery_hours is not None:
                shipping_performance_by_day[delivery_key]["avg_total_hours"].append(total_delivery_hours)

        if _has_shipping_exception(order):
            reference_exception_at = _as_utc((_latest_event(order.shipment).occurred_at if _latest_event(order.shipment) else order.created_at))
            exception_key = reference_exception_at.date().isoformat() if reference_exception_at else date_key
            shipping_performance_by_day[exception_key]["exception_orders"] += 1

        # Use fine-grained tracking status for shipped orders when available
        effective_status = _effective_tracking_status(order, order_status_val)
        status_counter[effective_status] += 1
        shipping_stage = _shipment_stage(order)
        shipping_status_counter[shipping_stage] += 1
        shop_key = (order.shop_id, _safe_text(order.shop.name if order.shop else None, f"Shop #{order.shop_id}"))
        shop_counter[shop_key] += 1
        top_shop_buckets[shop_key]["orders"] += 1
        if order.is_personalized:
            top_shop_buckets[shop_key]["personalized_orders"] += 1
        if shipping_stage == "delivered":
            top_shop_buckets[shop_key]["delivered_orders"] += 1

        for incident in order.incidents:
            incident_type_counter[_safe_text(_enum_value(incident.type), "unknown")] += 1

        for item in order.items:
            sku_key = (_safe_text(item.sku, "sin-sku"), _safe_text(item.name, "Sin nombre"))
            sku_totals[sku_key]["quantity"] += _safe_int(item.quantity, 0)
            sku_totals[sku_key]["orders"] += 1

        carrier = _carrier_for_order(order)
        if carrier:
            carrier_buckets[carrier]["shipments"] += 1
            if _enum_value(order.status) == "delivered":
                carrier_buckets[carrier]["delivered_orders"] += 1
            if any(_enum_value(incident.status) != IncidentStatus.resolved.value for incident in order.incidents):
                carrier_buckets[carrier]["incident_orders"] += 1
            delivered_event = _delivered_event(order.shipment)
            hours = _hours_between(order.shipment.created_at if order.shipment else None, delivered_event.occurred_at if delivered_event else None)
            if hours is not None:
                carrier_buckets[carrier]["delivery_hours"].append(hours)

        reasons: list[str] = []
        age_hours = _hours_between(order.created_at, now) or 0.0
        if order.shipment is None and age_hours >= SENT_SLA_HOURS:
            reasons.append("Sin shipment")
        if _is_without_tracking(order):
            reasons.append("Sin tracking")
        if _is_prepared_not_collected(order, now):
            reasons.append("Preparado sin recogida")
        if _is_tracking_stalled(order, now):
            reasons.append("Tracking parado")
        if _has_shipping_exception(order):
            reasons.append("Excepción carrier")
        if _is_outside_delivery_sla(order, now):
            reasons.append("Fuera de SLA")
        if _is_blocked(order) and not _has_shipping_exception(order):
            reasons.append("Incidencia abierta")
        if reasons:
            latest_event = _latest_event(order.shipment)
            last_event_at = _as_utc(latest_event.occurred_at if latest_event else (order.shipment.created_at if order.shipment else order.created_at))
            hours_since_update = _hours_between(last_event_at, now) if last_event_at is not None else None
            delayed_orders.append(
                {
                    "order_id": order.id,
                    "external_id": _safe_text(order.external_id, f"Pedido #{order.id}"),
                    "shop_name": _safe_text(order.shop.name if order.shop else None, f"Shop #{order.shop_id}"),
                    "customer_name": _safe_text(order.customer_name, "Sin cliente"),
                    "status": _safe_text(_enum_value(order.status), "unknown"),
                    "production_status": _safe_text(_enum_value(order.production_status), "unknown"),
                    "age_hours": round(age_hours, 1),
                    "reason": " · ".join(reasons),
                }
            )
            attention_shipments.append(
                {
                    "order_id": order.id,
                    "external_id": _safe_text(order.external_id, f"Pedido #{order.id}"),
                    "shop_name": _safe_text(order.shop.name if order.shop else None, f"Shop #{order.shop_id}"),
                    "customer_name": _safe_text(order.customer_name, "Sin cliente"),
                    "tracking_number": _safe_text(order.shipment.tracking_number if order.shipment else None, "") or None,
                    "current_stage": shipping_stage,
                    "latest_event_label": _latest_event_label(order),
                    "last_event_at": last_event_at,
                    "hours_since_update": round(hours_since_update, 1) if hours_since_update is not None else None,
                    "risk_reason": " · ".join(reasons),
                    "_score": (30 if "Fuera de SLA" in reasons else 0)
                    + (24 if "Excepción carrier" in reasons else 0)
                    + (18 if "Tracking parado" in reasons else 0)
                    + (14 if "Preparado sin recogida" in reasons else 0)
                    + (10 if "Sin tracking" in reasons else 0)
                    + (8 if "Sin shipment" in reasons else 0)
                    + int(min(age_hours, 240)),
                }
            )

    carrier_performance = [
        {
            "carrier": carrier,
            "shipments": data["shipments"],
            "delivered_orders": data["delivered_orders"],
            "avg_delivery_hours": round(mean(data["delivery_hours"]), 1) if data["delivery_hours"] else None,
            "incident_rate": _percentage(data["incident_orders"], data["shipments"]),
        }
        for carrier, data in sorted(carrier_buckets.items(), key=lambda item: (-item[1]["shipments"], _safe_text(item[0], "").lower()))
    ]

    shipping_status_distribution = [
        {
            "label": label,
            "value": value,
            "percentage": _percentage(value, total_orders),
        }
        for label, value in (
            ("pending", len(pending_orders)),
            ("prepared", len(prepared_orders)),
            ("picked_up", len(picked_up_orders)),
            ("in_transit", len(in_transit_orders)),
            ("out_for_delivery", len(out_for_delivery_orders)),
            ("delivered", len(delivered_orders)),
            ("exception", len(exception_orders)),
            ("stalled", len(stalled_tracking_orders)),
        )
        if value > 0
    ]

    shipping_performance_series = [
        {
            "date": date_key,
            "created_shipments": values["created_shipments"],
            "delivered_orders": values["delivered_orders"],
            "exception_orders": values["exception_orders"],
            "on_time_delivery_rate": _percentage(values["on_time_hits"], values["on_time_total"]),
            "avg_transit_hours": round(mean(values["avg_transit_hours"]), 1) if values["avg_transit_hours"] else None,
            "avg_total_hours": round(mean(values["avg_total_hours"]), 1) if values["avg_total_hours"] else None,
        }
        for date_key, values in sorted(shipping_performance_by_day.items())
    ]

    charts = {
        "orders_by_day": [
            {
                "date": date_key,
                "total": values["total"],
                "personalized": values["personalized"],
                "standard": values["standard"],
                "delivered": values["delivered"],
                "exception": values["exception"],
            }
            for date_key, values in sorted(orders_by_day_counter.items())
        ],
        "personalization_mix": [
            {
                "label": label,
                "value": value,
                "percentage": _percentage(value, total_orders),
            }
            for label, value in personalized_breakdown.items()
        ],
        "status_distribution": [
            {
                "label": label,
                "value": value,
                "percentage": _percentage(value, total_orders),
            }
            for label, value in status_counter.most_common()
        ],
        "orders_by_shop": [
            {
                "label": label,
                "value": value,
                "percentage": _percentage(value, total_orders),
            }
            for (_, label), value in shop_counter.most_common(10)
        ],
        "incidents_by_type": [
            {
                "label": label,
                "value": value,
                "percentage": _percentage(value, len(open_incidents)),
            }
            for label, value in incident_type_counter.most_common()
        ],
        "carrier_performance": [
            {
                "label": item["carrier"],
                "value": item["shipments"],
                "percentage": item["incident_rate"],
            }
            for item in carrier_performance
        ],
    }

    rankings = {
        "top_shops": [
            {
                "shop_id": shop_id,
                "shop_name": shop_name,
                "orders": values["orders"],
                "personalized_orders": values["personalized_orders"],
                "delivered_orders": values["delivered_orders"],
            }
            for (shop_id, shop_name), values in sorted(
                top_shop_buckets.items(),
                key=lambda item: (-item[1]["orders"], _safe_text(item[0][1], "").lower()),
            )[:10]
        ],
        "top_skus": [
            {
                "sku": sku,
                "name": name,
                "quantity": values["quantity"],
                "orders": values["orders"],
            }
            for (sku, name), values in sorted(
                sku_totals.items(),
                key=lambda item: (-item[1]["quantity"], _safe_text(item[0][1], "").lower()),
            )[:10]
        ],
        "top_incidents": [
            {
                "label": label,
                "value": value,
                "percentage": _percentage(value, len(open_incidents)),
            }
            for label, value in incident_type_counter.most_common(10)
        ],
        "delayed_orders": sorted(delayed_orders, key=lambda item: (-item["age_hours"], item["external_id"]))[:10],
        "attention_shipments": [
            {key: value for key, value in item.items() if key != "_score"}
            for item in sorted(
                attention_shipments,
                key=lambda item: (-item["_score"], -(item["hours_since_update"] or 0), item["external_id"]),
            )[:18]
        ],
    }

    return {
        "scope": {
            "shop_count": len({order.shop_id for order in orders}),
            "available_channels": ["shopify"] if channel_shop_ids else [],
            "generated_at": now,
        },
        "filters": {
            "date_from": filters.date_from,
            "date_to": filters.date_to,
            "shop_id": filters.shop_id,
            "channel": filters.channel,
            "is_personalized": filters.is_personalized,
            "status": filters.status,
            "production_status": filters.production_status,
            "carrier": filters.carrier,
        },
        "kpis": {
            "total_orders": total_orders,
            "orders_today": len(created_today),
            "orders_this_week": len(created_this_week),
            "orders_this_month": len(created_this_month),
            "personalized_orders": len(personalized_orders),
            "standard_orders": len(standard_orders),
            "in_production_orders": sum(1 for order in orders if _enum_value(order.production_status) == "in_production"),
            "shipped_orders": len(shipped_orders),
            "delivered_orders": len(delivered_orders),
            "open_incidents": len(open_incidents),
        },
        "operational": {
            "avg_order_to_production_hours": None,
            "avg_production_to_shipping_hours": None,
            "avg_shipping_to_delivery_hours": round(mean(delivery_hours), 1) if delivery_hours else None,
            "sent_in_sla_rate": _percentage(sum(1 for hours in sent_sla_hours if hours <= SENT_SLA_HOURS), len(sent_sla_hours)),
            "delivered_in_sla_rate": _percentage(sum(1 for hours in delivery_hours if hours <= DELIVERED_SLA_HOURS), len(delivery_hours)),
            "blocked_orders": len(blocked_orders),
            "orders_without_shipment": len(orders_without_shipment),
            "orders_without_tracking": len(orders_without_tracking),
            "prepared_not_collected_orders": len(prepared_not_collected_orders),
            "outside_sla_orders": len(outside_sla_orders),
            "stalled_tracking_orders": len(stalled_tracking_orders),
            "incident_rate": _percentage(len({incident.order_id for incident in open_incidents}), total_orders),
            "aging_buckets": aging_buckets,
        },
        "personalization": {
            "personalized_share": _percentage(len(personalized_orders), total_orders),
            "standard_share": _percentage(len(standard_orders), total_orders),
            "personalized_today": sum(1 for order in created_today if order.is_personalized),
            "personalized_this_week": sum(1 for order in created_this_week if order.is_personalized),
            "personalized_this_month": sum(1 for order in created_this_month if order.is_personalized),
            "pending_assets_orders": len(pending_assets_orders),
            "pending_review_orders": len(pending_review_orders),
            "design_link_available_orders": len(design_link_available_orders),
            "personalized_blocked_orders": len(personalized_blocked_orders),
            "avg_personalized_preparation_hours": round(mean(personalized_prep_hours), 1) if personalized_prep_hours else None,
        },
        "shipping": {
            "pending_orders": len(pending_orders),
            "prepared_orders": len(prepared_orders),
            "picked_up_orders": len(picked_up_orders),
            "in_transit_orders": len(in_transit_orders),
            "out_for_delivery_orders": len(out_for_delivery_orders),
            "delivered_orders": len(delivered_orders),
            "exception_orders": len(exception_orders),
            "stalled_orders": len(stalled_tracking_orders),
            "without_tracking_orders": len(orders_without_tracking),
            "avg_transit_hours": round(mean(pickup_to_delivery_times), 1) if pickup_to_delivery_times else None,
            "avg_order_to_delivery_hours": round(mean(total_hours_list), 1) if total_hours_list else None,
            "carrier_performance": carrier_performance,
        },
        "charts": charts,
        "shipping_status_distribution": shipping_status_distribution,
        "shipping_performance_by_day": shipping_performance_series,
        "attention": {
            "tracking_stalled": len(stalled_tracking_orders),
            "without_shipment": len(orders_without_shipment),
            "without_tracking": len(orders_without_tracking),
            "carrier_exception": len(exception_orders),
            "outside_sla": len(outside_sla_orders),
            "prepared_not_collected": len(prepared_not_collected_orders),
        },
        "rankings": rankings,
        "flow": {
            "orders_received": total_orders,
            "orders_prepared": len(prepared_orders),
            "orders_picked_up": len(picked_up_orders),
            "orders_in_transit": len(in_transit_orders),
            "orders_out_for_delivery": len(out_for_delivery_orders),
            "orders_delivered": len(delivered_orders),
            "orders_exception": len(exception_orders),
            "avg_order_to_label_hours": round(mean(sent_sla_hours), 1) if sent_sla_hours else None,
            "avg_label_to_transit_hours": round(mean(first_transit_times), 1) if first_transit_times else None,
            "avg_transit_to_delivery_hours": round(mean(delivery_hours), 1) if delivery_hours else None,
            "avg_total_hours": round(mean(total_hours_list), 1) if total_hours_list else None,
            "avg_order_to_prepared_hours": round(mean(sent_sla_hours), 1) if sent_sla_hours else None,
            "avg_prepared_to_picked_up_hours": round(mean(first_pickup_times), 1) if first_pickup_times else None,
            "avg_picked_up_to_delivered_hours": round(mean(pickup_to_delivery_times), 1) if pickup_to_delivery_times else None,
            "avg_order_to_delivered_hours": round(mean(total_hours_list), 1) if total_hours_list else None,
        },
    }
