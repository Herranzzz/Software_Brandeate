from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from app.models import Order, ShippingRateQuote, ShippingQuoteSource


@dataclass
class LiveRateContext:
    shop_id: int
    order_id: int | None
    destination_country_code: str
    destination_postal_code: str
    destination_city: str | None
    weight_tier_code: str | None
    weight_kg: float | None
    is_personalized: bool | None


@dataclass
class LiveRateQuoteData:
    carrier: str
    service_code: str
    service_name: str
    delivery_type: str
    amount: float
    currency: str
    estimated_days_min: int | None
    estimated_days_max: int | None
    weight_tier_code: str | None
    source: ShippingQuoteSource


def get_live_rates(context: LiveRateContext) -> list[LiveRateQuoteData]:
    """Return mock quotes for now. Swap with carrier integrations later."""
    base_amount = 4.9 if context.destination_country_code.upper() == "ES" else 9.5
    if context.is_personalized:
        base_amount += 1.2

    weight_modifier = 0.0
    if context.weight_kg:
        weight_modifier = max(0.0, context.weight_kg - 1.0) * 0.7

    return [
        LiveRateQuoteData(
            carrier="CTT",
            service_code="C24",
            service_name="CTT 24H",
            delivery_type="home",
            amount=round(base_amount + weight_modifier, 2),
            currency="EUR",
            estimated_days_min=1,
            estimated_days_max=2,
            weight_tier_code=context.weight_tier_code,
            source=ShippingQuoteSource.mock,
        ),
        LiveRateQuoteData(
            carrier="CTT",
            service_code="C48",
            service_name="CTT 48H",
            delivery_type="home",
            amount=round(base_amount - 0.8 + weight_modifier, 2),
            currency="EUR",
            estimated_days_min=2,
            estimated_days_max=3,
            weight_tier_code=context.weight_tier_code,
            source=ShippingQuoteSource.mock,
        ),
        LiveRateQuoteData(
            carrier="CTT",
            service_code="CTT_PICKUP",
            service_name="CTT Punto de recogida",
            delivery_type="pickup_point",
            amount=round(base_amount - 1.2 + weight_modifier, 2),
            currency="EUR",
            estimated_days_min=2,
            estimated_days_max=4,
            weight_tier_code=context.weight_tier_code,
            source=ShippingQuoteSource.mock,
        ),
    ]


def store_quotes(
    *,
    db,
    quotes: Iterable[LiveRateQuoteData],
    context: LiveRateContext,
) -> list[ShippingRateQuote]:
    stored: list[ShippingRateQuote] = []
    expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    for quote in quotes:
        record = ShippingRateQuote(
            order_id=context.order_id,
            shop_id=context.shop_id,
            carrier=quote.carrier,
            service_code=quote.service_code,
            service_name=quote.service_name,
            delivery_type=quote.delivery_type,
            amount=quote.amount,
            currency=quote.currency,
            estimated_days_min=quote.estimated_days_min,
            estimated_days_max=quote.estimated_days_max,
            weight_tier_code=quote.weight_tier_code,
            destination_country_code=context.destination_country_code,
            destination_postal_code=context.destination_postal_code,
            destination_city=context.destination_city,
            is_personalized=context.is_personalized,
            source=quote.source,
            expires_at=expires_at,
        )
        db.add(record)
        stored.append(record)
    db.commit()
    for record in stored:
        db.refresh(record)
    return stored


def apply_shipping_selection(
    *,
    order: Order,
    selection: dict,
) -> None:
    order.delivery_type = selection.get("delivery_type") or order.delivery_type
    order.shipping_service_code = selection.get("service_code") or order.shipping_service_code
    order.shipping_service_name = selection.get("service_name") or order.shipping_service_name
    if selection.get("amount") is not None:
        order.shipping_rate_amount = selection.get("amount")
    if selection.get("currency") is not None:
        order.shipping_rate_currency = selection.get("currency")
    order.shipping_rate_estimated_days_min = selection.get("estimated_days_min")
    order.shipping_rate_estimated_days_max = selection.get("estimated_days_max")
    order.shipping_rate_quote_id = selection.get("quote_id")
    order.pickup_point_json = selection.get("pickup_point")
    order.shipping_option_selected_at = datetime.now(timezone.utc)
