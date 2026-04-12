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

    def _format_hours(raw_hours: list[dict]) -> list[str]:
        """Convert CTT opening_hours array to readable strings like 'LUN 13:00-19:00'."""
        day_map = {
            "MON": "Lun", "TUE": "Mar", "WED": "Mié",
            "THU": "Jue", "FRI": "Vie", "SAT": "Sáb", "SUN": "Dom",
        }
        lines = []
        for entry in raw_hours:
            day = day_map.get(entry.get("day_of_week", ""), entry.get("day_of_week", ""))
            for slot in entry.get("hours", []):
                lines.append(f"{day} {slot.get('from', '')}–{slot.get('to', '')}")
        return lines or []

    def _parse_point(i: int, pt: dict) -> PickupPoint:
        addr = pt.get("address") or {}
        # address may be a nested dict or a flat string
        if isinstance(addr, dict):
            addr_str = _str(addr.get("address") or addr.get("street") or addr.get("address1") or "")
            city = _str(addr.get("town") or addr.get("city") or payload.destination_city or "")
            postal = _str(addr.get("postal_code") or addr.get("zip_code") or payload.destination_postal_code)
            country = _str(addr.get("country_code") or addr.get("country") or payload.destination_country_code)
            gps = addr.get("gps_location") or {}
            lat = float(gps["latitude"]) if gps.get("latitude") is not None else None
            lng = float(gps["longitude"]) if gps.get("longitude") is not None else None
        else:
            addr_str = _str(addr)
            city = _str(pt.get("city") or pt.get("town") or payload.destination_city or "")
            postal = _str(pt.get("postal_code") or payload.destination_postal_code)
            country = _str(pt.get("country_code") or payload.destination_country_code)
            lat = float(pt["latitude"]) if pt.get("latitude") is not None else None
            lng = float(pt["longitude"]) if pt.get("longitude") is not None else None

        raw_oh = pt.get("opening_hours") or []
        if isinstance(raw_oh, list) and raw_oh and isinstance(raw_oh[0], dict) and "day_of_week" in raw_oh[0]:
            hours = _format_hours(raw_oh) or None
        elif isinstance(raw_oh, list):
            hours = [str(h) for h in raw_oh] or None
        elif isinstance(raw_oh, str) and raw_oh.strip():
            hours = [raw_oh.strip()]
        else:
            hours = None

        return PickupPoint(
            id=_str(pt.get("organic_point_code") or pt.get("code") or pt.get("id") or str(i)),
            name=_str(pt.get("point_name") or pt.get("name") or pt.get("commercial_name") or f"Punto CTT {i}"),
            address1=addr_str or "—",
            address2=_str(pt.get("address2")) or None,
            city=city,
            province=_str(pt.get("province") or pt.get("region")) or None,
            postal_code=postal,
            country_code=country,
            carrier=payload.carrier,
            latitude=lat,
            longitude=lng,
            opening_hours=hours,
        )

    points = [_parse_point(i, pt) for i, pt in enumerate(raw_points)]

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
