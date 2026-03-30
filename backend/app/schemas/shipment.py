from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TrackingEventCreate(BaseModel):
    status_norm: str = Field(min_length=1, max_length=120)
    status_raw: str | None = Field(default=None, max_length=5000)
    occurred_at: datetime


class TrackingEventRead(TrackingEventCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shipment_id: int
    created_at: datetime


class ShipmentCreate(BaseModel):
    order_id: int = Field(gt=0)
    carrier: str = Field(min_length=1, max_length=120)
    tracking_number: str = Field(min_length=1, max_length=255)
    tracking_url: str | None = Field(default=None, max_length=2048)
    shipping_status: str | None = Field(default=None, max_length=120)
    shipping_status_detail: str | None = Field(default=None, max_length=5000)


class ShipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    fulfillment_id: str | None
    carrier: str
    tracking_number: str
    tracking_url: str | None
    shipping_status: str | None
    shipping_status_detail: str | None
    public_token: str
    created_at: datetime
    events: list[TrackingEventRead] = Field(default_factory=list)
