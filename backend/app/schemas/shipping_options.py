from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LiveRateRequest(BaseModel):
    shop_id: int = Field(gt=0)
    order_id: int | None = None
    destination_country_code: str = Field(min_length=2, max_length=8)
    destination_postal_code: str = Field(min_length=3, max_length=32)
    destination_city: str | None = Field(default=None, max_length=120)
    weight_tier_code: str | None = Field(default=None, max_length=64)
    weight_kg: float | None = None
    is_personalized: bool | None = None


class LiveRateQuote(BaseModel):
    quote_id: int | None = None
    carrier: str
    service_code: str
    service_name: str
    delivery_type: str
    amount: float
    currency: str
    estimated_days_min: int | None = None
    estimated_days_max: int | None = None
    weight_tier_code: str | None = None


class LiveRateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    currency: str
    quotes: list[LiveRateQuote]
    generated_at: datetime


class PickupPointRequest(BaseModel):
    shop_id: int = Field(gt=0)
    carrier: str = Field(min_length=2, max_length=64)
    destination_country_code: str = Field(min_length=2, max_length=8)
    destination_postal_code: str = Field(min_length=3, max_length=32)
    destination_city: str | None = Field(default=None, max_length=120)
    max_distance_km: int | None = Field(default=None, ge=1, le=100)


class PickupPoint(BaseModel):
    id: str
    name: str
    address1: str
    address2: str | None = None
    city: str
    province: str | None = None
    postal_code: str
    country_code: str
    carrier: str
    latitude: float | None = None
    longitude: float | None = None
    opening_hours: list[str] | None = None


class PickupPointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    points: list[PickupPoint]
    generated_at: datetime


class ShippingOptionSelection(BaseModel):
    order_id: int = Field(gt=0)
    delivery_type: str = Field(min_length=2, max_length=32)
    carrier: str = Field(min_length=2, max_length=64)
    service_code: str | None = Field(default=None, max_length=64)
    service_name: str | None = Field(default=None, max_length=120)
    quote_id: int | None = None
    amount: float | None = None
    currency: str | None = Field(default=None, max_length=8)
    estimated_days_min: int | None = None
    estimated_days_max: int | None = None
    pickup_point: dict | None = None
