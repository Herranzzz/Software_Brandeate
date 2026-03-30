from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import IncidentStatus, Order, Shipment, ShopIntegration, TrackingEvent


UTC = timezone.utc
SENT_SLA_HOURS = 48
DELIVERED_SLA_HOURS = 72
TRACKING_STALLED_HOURS = 72


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
            selectinload(Order.shop),
            selectinload(Order.items),
            selectinload(Order.shipment).selectinload(Shipment.events),
            selectinload(Order.incidents),
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
    )

    if accessible_shop_ids is not None:
        query = query.where(Order.shop_id.in_(accessible_shop_ids))

    orders = [order for order in db.scalars(query) if _order_matches_filters(order, filters, channel_shop_ids)]

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
    stalled_tracking_orders = [order for order in orders if _is_tracking_stalled(order, now)]

    created_today = [order for order in orders if (_as_utc(order.created_at) or now).date().isoformat() == today_key]
    created_this_week = [order for order in orders if (_as_utc(order.created_at) or now).date() >= week_start]
    created_this_month = [order for order in orders if (_as_utc(order.created_at) or now).date() >= month_start]

    shipped_orders = [order for order in orders if _enum_value(order.status) == "shipped"]
    delivered_orders = [order for order in orders if _enum_value(order.status) == "delivered"]

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

    in_transit_orders = [
        order
        for order in orders
        if (latest := _latest_event(order.shipment)) is not None
        and _safe_text(latest.status_norm, "").lower() in {"label_created", "in_transit", "out_for_delivery", "pickup_available"}
    ]
    exception_orders = [
        order
        for order in orders
        if _enum_value(order.status) == "exception"
        or ((latest := _latest_event(order.shipment)) is not None and _safe_text(latest.status_norm, "").lower() == "exception")
    ]

    orders_by_day_counter: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "personalized": 0, "standard": 0})
    status_counter: Counter[str] = Counter()
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

    for order in orders:
        created_at = _as_utc(order.created_at)
        date_key = created_at.date().isoformat() if created_at else today_key
        orders_by_day_counter[date_key]["total"] += 1
        orders_by_day_counter[date_key]["personalized" if order.is_personalized else "standard"] += 1

        status_counter[_safe_text(_enum_value(order.status), "unknown")] += 1
        shop_key = (order.shop_id, _safe_text(order.shop.name if order.shop else None, f"Shop #{order.shop_id}"))
        shop_counter[shop_key] += 1
        top_shop_buckets[shop_key]["orders"] += 1
        if order.is_personalized:
            top_shop_buckets[shop_key]["personalized_orders"] += 1
        if _enum_value(order.status) == "delivered":
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
        if _is_tracking_stalled(order, now):
            reasons.append("Tracking parado")
        if _is_blocked(order):
            reasons.append("Incidencia abierta")
        if reasons:
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

    charts = {
        "orders_by_day": [
            {
                "date": date_key,
                "total": values["total"],
                "personalized": values["personalized"],
                "standard": values["standard"],
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
            "stalled_tracking_orders": len(stalled_tracking_orders),
            "incident_rate": _percentage(len({incident.order_id for incident in open_incidents}), total_orders),
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
            "in_transit_orders": len(in_transit_orders),
            "delivered_orders": len(delivered_orders),
            "exception_orders": len(exception_orders),
            "carrier_performance": carrier_performance,
        },
        "charts": charts,
        "rankings": rankings,
    }
