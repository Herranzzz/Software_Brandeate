"""Build a rich, render-ready context dict for an order.

The current `_build_html` only has access to order_id, customer_name,
tracking_url and carrier. Templates can't say much beyond "your order
is on its way" with that. This module gathers everything a template
or LLM agent might want to mention: line items, totals, shipping
address summary, latest tracking event, ETA, open incidents, locale.

Pure read-only. Does not commit, mutate, or call external services.
"""

from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from app.models.incident import Incident, IncidentStatus
from app.models.order import Order
from app.models.shop import Shop


BRAND_RED = "#e8392b"

# Default locale per shipping country. Customers can be in NL/PT/etc but
# we only support the languages we have templates for; everything else
# falls back to English.
_LOCALE_BY_COUNTRY = {
    "ES": "es",
    "MX": "es",
    "AR": "es",
    "CO": "es",
    "CL": "es",
    "PE": "es",
    "PT": "pt",
    "BR": "pt",
    "FR": "en",  # no FR template yet
    "DE": "en",
    "IT": "en",
    "GB": "en",
    "IE": "en",
    "US": "en",
    "CA": "en",
}

_SUPPORTED_LOCALES = {"es", "en", "pt"}


@dataclass
class ItemLine:
    name: str
    quantity: int
    sku: str | None = None
    variant: str | None = None


@dataclass
class TrackingSummary:
    status: str | None
    status_detail: str | None
    location: str | None
    occurred_at: datetime | None
    carrier: str | None
    tracking_number: str | None
    tracking_url: str | None
    expected_delivery_date: date | None
    is_pickup_point: bool
    pickup_point_name: str | None


@dataclass
class IncidentSummary:
    type: str
    priority: str
    title: str
    description: str | None


@dataclass
class EmailContext:
    locale: str
    shop_name: str
    shop_id: int
    accent_color: str
    support_email: str | None
    customer_email: str
    customer_first_name: str
    customer_full_name: str | None
    order_id_external: str
    order_id_internal: int
    order_total: float | None
    order_currency: str | None
    order_created_at: datetime | None
    items: list[ItemLine]
    item_count: int
    shipping_address_line: str | None
    shipping_city: str | None
    shipping_country: str | None
    tracking: TrackingSummary
    open_incidents: list[IncidentSummary]
    has_open_incidents: bool

    def as_template_dict(self) -> dict[str, Any]:
        """Flatten for use with .format()-style templates and JSON."""
        d = asdict(self)
        d["items"] = [asdict(i) for i in self.items]
        d["tracking"] = asdict(self.tracking)
        d["open_incidents"] = [asdict(i) for i in self.open_incidents]
        return d


def build_email_context(order: Order, shop: Shop | None) -> EmailContext:
    """Collect all order/shop/shipment data a template or agent might want."""
    shop_name = (shop.name if shop else None) or "Brandeate"
    accent = _accent_color(shop)
    support_email = _support_email(shop)
    locale = _resolve_locale(order, shop)

    full_name = (order.customer_name or order.shipping_name or "").strip() or None
    first_name = full_name.split()[0] if full_name else ""

    items = [
        ItemLine(
            name=(item.title or item.name or item.sku or "Producto").strip(),
            quantity=int(item.quantity or 0),
            sku=item.sku,
            variant=(item.variant_title or None),
        )
        for item in (order.items or [])
        if (item.quantity or 0) > 0
    ]
    item_count = sum(i.quantity for i in items)

    order_total, order_currency = _resolve_total(order)

    shipping_line = _format_address_line(order)
    shipping_city = order.shipping_town
    shipping_country = order.shipping_country_code

    tracking = _build_tracking_summary(order)

    open_incidents = [
        IncidentSummary(
            type=_enum_value(inc.type),
            priority=_enum_value(inc.priority),
            title=inc.title,
            description=inc.description,
        )
        for inc in (order.incidents or [])
        if _enum_value(inc.status) != IncidentStatus.resolved.value
    ]

    return EmailContext(
        locale=locale,
        shop_name=shop_name,
        shop_id=order.shop_id,
        accent_color=accent,
        support_email=support_email,
        customer_email=order.customer_email,
        customer_first_name=first_name,
        customer_full_name=full_name,
        order_id_external=str(order.external_id or order.id),
        order_id_internal=order.id,
        order_total=order_total,
        order_currency=order_currency,
        order_created_at=order.created_at,
        items=items,
        item_count=item_count,
        shipping_address_line=shipping_line,
        shipping_city=shipping_city,
        shipping_country=shipping_country,
        tracking=tracking,
        open_incidents=open_incidents,
        has_open_incidents=bool(open_incidents),
    )


def _accent_color(shop: Shop | None) -> str:
    if shop and isinstance(shop.tracking_config_json, dict):
        color = shop.tracking_config_json.get("accent_color")
        if isinstance(color, str) and color.startswith("#"):
            return color
    return BRAND_RED


def _support_email(shop: Shop | None) -> str | None:
    if shop and isinstance(shop.marketing_config_json, dict):
        email = shop.marketing_config_json.get("support_email")
        if isinstance(email, str) and "@" in email:
            return email
    return None


def _resolve_locale(order: Order, shop: Shop | None) -> str:
    # 1. Per-shop override wins.
    if shop and isinstance(shop.marketing_config_json, dict):
        forced = shop.marketing_config_json.get("default_locale")
        if isinstance(forced, str) and forced.lower() in _SUPPORTED_LOCALES:
            return forced.lower()
    # 2. Country code → language guess.
    cc = (order.shipping_country_code or "").upper()
    if cc in _LOCALE_BY_COUNTRY:
        return _LOCALE_BY_COUNTRY[cc]
    return "es"


def _resolve_total(order: Order) -> tuple[float | None, str | None]:
    # No explicit grand total field on Order today; derive from items if
    # we ever store unit price. For now return None — templates degrade
    # gracefully when total is missing.
    rate = order.shipping_rate_amount
    currency = order.shipping_rate_currency or order.shopify_shipping_rate_currency
    if rate is not None and currency:
        return float(rate), currency
    return None, currency


def _format_address_line(order: Order) -> str | None:
    parts = [
        order.shipping_address_line1,
        order.shipping_address_line2,
        order.shipping_postal_code,
        order.shipping_town,
    ]
    cleaned = [p.strip() for p in parts if p and p.strip()]
    return ", ".join(cleaned) or None


def _build_tracking_summary(order: Order) -> TrackingSummary:
    shipment = order.shipment
    if shipment is None:
        return TrackingSummary(
            status=None, status_detail=None, location=None, occurred_at=None,
            carrier=None, tracking_number=None, tracking_url=None,
            expected_delivery_date=None,
            is_pickup_point=order.delivery_type and order.delivery_type.value == "pickup_point",
            pickup_point_name=_pickup_point_name(order),
        )

    last_event = shipment.events[0] if shipment.events else None

    return TrackingSummary(
        status=shipment.shipping_status,
        status_detail=shipment.shipping_status_detail,
        location=last_event.location if last_event else None,
        occurred_at=last_event.occurred_at if last_event else None,
        carrier=shipment.carrier,
        tracking_number=shipment.tracking_number,
        tracking_url=_public_tracking_url(shipment),
        expected_delivery_date=shipment.expected_delivery_date,
        is_pickup_point=bool(order.delivery_type and order.delivery_type.value == "pickup_point"),
        pickup_point_name=_pickup_point_name(order),
    )


def _public_tracking_url(shipment) -> str | None:
    if shipment and shipment.public_token:
        base = os.environ.get("PUBLIC_TRACKING_BASE_URL", "").rstrip("/")
        if base:
            return f"{base}/{shipment.public_token}"
    return shipment.tracking_url if shipment else None


def _pickup_point_name(order: Order) -> str | None:
    pp = order.pickup_point_json
    if isinstance(pp, dict):
        for key in ("name", "title", "label"):
            v = pp.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def _enum_value(v: Any) -> str:
    return v.value if hasattr(v, "value") else str(v)


_INVISIBLE_RE = re.compile(r"[​-‏ - ]")


def safe_subject(s: str) -> str:
    """Strip control / zero-width chars and collapse whitespace."""
    cleaned = _INVISIBLE_RE.sub("", s).strip()
    return re.sub(r"\s+", " ", cleaned)
