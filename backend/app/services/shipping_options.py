from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from app.models import Order, ShippingRateQuote, ShippingQuoteSource
from app.services.carriers import get_all_carriers


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
    """Get rates from all configured/active carriers."""
    results = []
    for provider in get_all_carriers():
        try:
            quotes = provider.get_rates(
                shop_id=context.shop_id,
                weight_kg=context.weight_kg or 1.0,
                destination_country=context.destination_country_code,
                destination_postal_code=context.destination_postal_code,
                destination_city=context.destination_city,
                is_personalized=context.is_personalized or False,
            )
            for q in quotes:
                results.append(LiveRateQuoteData(
                    carrier=q.carrier_code.upper(),
                    service_code=q.service_code,
                    service_name=q.service_name,
                    delivery_type=q.delivery_type,
                    amount=q.amount,
                    currency=q.currency,
                    estimated_days_min=q.estimated_days_min,
                    estimated_days_max=q.estimated_days_max,
                    weight_tier_code=q.weight_tier_code or context.weight_tier_code,
                    source=ShippingQuoteSource.ctt if q.carrier_code == "ctt" else ShippingQuoteSource.mock,
                ))
        except Exception:
            continue
    return results


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
