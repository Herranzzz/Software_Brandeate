from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db
from app.models import Order, ShippingRateQuote
from app.schemas.shipping_options import (
    LiveRateRequest,
    LiveRateResponse,
    LiveRateQuote,
    PickupPoint,
    PickupPointRequest,
    PickupPointResponse,
    ShippingOptionSelection,
)
from app.services.ctt import CTTError, get_pickup_points as ctt_get_pickup_points
from app.services.shipping_options import LiveRateContext, apply_shipping_selection, get_live_rates, store_quotes


router = APIRouter(prefix="/shipping-options", tags=["shipping-options"])


@router.post("/live-rates", response_model=LiveRateResponse)
def get_live_rates_api(
    payload: LiveRateRequest,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> LiveRateResponse:
    if accessible_shop_ids is not None and payload.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    context = LiveRateContext(
        shop_id=payload.shop_id,
        order_id=payload.order_id,
        destination_country_code=payload.destination_country_code,
        destination_postal_code=payload.destination_postal_code,
        destination_city=payload.destination_city,
        weight_tier_code=payload.weight_tier_code,
        weight_kg=payload.weight_kg,
        is_personalized=payload.is_personalized,
    )

    quotes = get_live_rates(context)
    stored = store_quotes(db=db, quotes=quotes, context=context)

    response_quotes = [
        LiveRateQuote(
            quote_id=record.id,
            carrier=record.carrier,
            service_code=record.service_code,
            service_name=record.service_name,
            delivery_type=record.delivery_type,
            amount=float(record.amount),
            currency=record.currency,
            estimated_days_min=record.estimated_days_min,
            estimated_days_max=record.estimated_days_max,
            weight_tier_code=record.weight_tier_code,
        )
        for record in stored
    ]

    return LiveRateResponse(
        currency=response_quotes[0].currency if response_quotes else "EUR",
        quotes=response_quotes,
        generated_at=datetime.now(timezone.utc),
    )


@router.post("/pickup-points", response_model=PickupPointResponse)
def get_pickup_points(
    payload: PickupPointRequest,
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> PickupPointResponse:
    if accessible_shop_ids is not None and payload.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    try:
        raw_points = ctt_get_pickup_points(
            postal_code=payload.destination_postal_code,
            country_code=payload.destination_country_code,
        )
    except CTTError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"CTT API error: {exc}",
        ) from exc

    def _str(v: object) -> str:
        return str(v).strip() if v is not None else ""

    def _hours(pt: dict) -> list[str] | None:
        raw = pt.get("schedule") or pt.get("opening_hours") or pt.get("hours")
        if isinstance(raw, list):
            return [str(h) for h in raw] or None
        if isinstance(raw, str) and raw.strip():
            return [raw.strip()]
        return None

    points = [
        PickupPoint(
            id=_str(pt.get("code") or pt.get("id") or pt.get("distribution_point_code") or i),
            name=_str(pt.get("name") or pt.get("description") or pt.get("commercial_name") or f"Punto CTT {i}"),
            address1=_str(pt.get("address") or pt.get("address1") or pt.get("street") or ""),
            address2=_str(pt.get("address2") or pt.get("address_complement")) or None,
            city=_str(pt.get("city") or pt.get("town") or pt.get("municipality") or payload.destination_city or ""),
            province=_str(pt.get("province") or pt.get("region")) or None,
            postal_code=_str(pt.get("postal_code") or pt.get("zip_code") or payload.destination_postal_code),
            country_code=_str(pt.get("country_code") or pt.get("country") or payload.destination_country_code),
            carrier=payload.carrier,
            latitude=float(pt["latitude"]) if pt.get("latitude") is not None else None,
            longitude=float(pt["longitude"]) if pt.get("longitude") is not None else None,
            opening_hours=_hours(pt),
        )
        for i, pt in enumerate(raw_points)
    ]

    return PickupPointResponse(points=points, generated_at=datetime.now(timezone.utc))


@router.post("/select", response_model=dict)
def select_shipping_option(
    payload: ShippingOptionSelection,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Order:
    order = db.get(Order, payload.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    selection = payload.model_dump()
    if payload.quote_id is not None:
        quote = db.scalar(select(ShippingRateQuote).where(ShippingRateQuote.id == payload.quote_id))
        if quote is not None:
            selection.update(
                {
                    "service_code": quote.service_code,
                    "service_name": quote.service_name,
                    "delivery_type": quote.delivery_type,
                    "amount": float(quote.amount),
                    "currency": quote.currency,
                    "estimated_days_min": quote.estimated_days_min,
                    "estimated_days_max": quote.estimated_days_max,
                    "quote_id": quote.id,
                }
            )

    apply_shipping_selection(order=order, selection=selection)
    db.commit()
    order = db.scalar(select(Order).where(Order.id == order.id))
    return {
        "order_id": order.id,
        "delivery_type": order.delivery_type,
        "shipping_service_code": order.shipping_service_code,
        "shipping_service_name": order.shipping_service_name,
        "shipping_rate_amount": order.shipping_rate_amount,
        "shipping_rate_currency": order.shipping_rate_currency,
        "pickup_point_json": order.pickup_point_json,
    }
