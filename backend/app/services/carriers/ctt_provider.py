from __future__ import annotations
from typing import Optional
from .base import CarrierProvider, RateQuote, TrackingResult, TrackingEventData


class CTTProvider(CarrierProvider):
    code = "ctt"
    name = "CTT Express"
    supports_live_rates = False  # CTT doesn't have a rate API; we use configured prices
    supports_label_creation = True
    supports_tracking = True

    def get_rates(
        self,
        *,
        shop_id: int,
        weight_kg: float,
        destination_country: str,
        destination_postal_code: str,
        destination_city: Optional[str] = None,
        is_personalized: bool = False,
    ) -> list[RateQuote]:
        """Return CTT rate estimates based on configured pricing."""
        base = 4.9 if destination_country.upper() == "ES" else 9.5
        if is_personalized:
            base += 1.2
        weight_mod = max(0.0, weight_kg - 1.0) * 0.7 if weight_kg else 0.0

        return [
            RateQuote(
                carrier_code="ctt",
                carrier_name="CTT Express",
                service_code="C24",
                service_name="CTT 24H",
                delivery_type="home",
                amount=round(base + weight_mod, 2),
                estimated_days_min=1,
                estimated_days_max=2,
            ),
            RateQuote(
                carrier_code="ctt",
                carrier_name="CTT Express",
                service_code="C48",
                service_name="CTT 48H",
                delivery_type="home",
                amount=round(base - 0.8 + weight_mod, 2),
                estimated_days_min=2,
                estimated_days_max=3,
            ),
            RateQuote(
                carrier_code="ctt",
                carrier_name="CTT Express",
                service_code="CTT_PICKUP",
                service_name="CTT Punto de recogida",
                delivery_type="pickup_point",
                amount=round(base - 1.2 + weight_mod, 2),
                estimated_days_min=2,
                estimated_days_max=4,
            ),
        ]

    def get_tracking(self, tracking_number: str) -> TrackingResult:
        """Delegate to existing CTT tracking service."""
        from app.services.ctt import get_tracking as ctt_get_tracking
        try:
            raw = ctt_get_tracking(tracking_number)
            # raw is expected to be a dict with tracking event data from CTT API
            events_raw = raw.get("events", []) if isinstance(raw, dict) else []
        except Exception:
            events_raw = []

        events = [
            TrackingEventData(
                occurred_at=ev.get("occurred_at", ""),
                status=ev.get("status", ""),
                description=ev.get("description", ""),
                location=ev.get("location"),
            )
            for ev in events_raw
            if isinstance(ev, dict)
        ]
        current = events[0] if events else None
        return TrackingResult(
            carrier_code="ctt",
            tracking_number=tracking_number,
            current_status=current.status if current else "unknown",
            current_status_detail=current.description if current else None,
            events=events,
        )
