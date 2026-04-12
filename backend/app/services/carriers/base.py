from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RateQuote:
    carrier_code: str
    carrier_name: str
    service_code: str
    service_name: str
    delivery_type: str  # "home" | "pickup_point"
    amount: float
    currency: str = "EUR"
    estimated_days_min: Optional[int] = None
    estimated_days_max: Optional[int] = None
    weight_tier_code: Optional[str] = None


@dataclass
class LabelResult:
    tracking_number: str
    tracking_url: str
    label_pdf_b64: str
    carrier_reference: Optional[str] = None
    provider_reference: Optional[str] = None


@dataclass
class TrackingEventData:
    occurred_at: str
    status: str
    description: str
    location: Optional[str] = None


@dataclass
class TrackingResult:
    carrier_code: str
    tracking_number: str
    current_status: str
    current_status_detail: Optional[str] = None
    events: list[TrackingEventData] = field(default_factory=list)


class CarrierProvider(ABC):
    """Abstract base for carrier integrations."""

    code: str  # e.g. "ctt"
    name: str  # e.g. "CTT Express"
    supports_live_rates: bool = False
    supports_label_creation: bool = True
    supports_tracking: bool = True

    @abstractmethod
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
        """Return available rate quotes for a shipment."""
        ...

    @abstractmethod
    def get_tracking(self, tracking_number: str) -> TrackingResult:
        """Fetch current tracking status and events."""
        ...
