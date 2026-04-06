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

    points = [
        PickupPoint(
            id="CTT-OVD-001",
            name="CTT Punto Oviedo Centro",
            address1="Calle San Francisco 12",
            address2=None,
            city=payload.destination_city or "Oviedo",
            province="Asturias",
            postal_code=payload.destination_postal_code,
            country_code=payload.destination_country_code,
            carrier=payload.carrier,
            latitude=43.3603,
            longitude=-5.8448,
            opening_hours=["L-V 09:00-19:00", "S 10:00-14:00"],
        ),
        PickupPoint(
            id="CTT-OVD-002",
            name="CTT Punto Oviedo Norte",
            address1="Av. de Galicia 25",
            address2="Local 4",
            city=payload.destination_city or "Oviedo",
            province="Asturias",
            postal_code=payload.destination_postal_code,
            country_code=payload.destination_country_code,
            carrier=payload.carrier,
            latitude=43.375,
            longitude=-5.858,
            opening_hours=["L-V 08:30-18:30"],
        ),
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
