from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TrackingEventCreate(BaseModel):
    status_norm: str = Field(min_length=1, max_length=120)
    status_raw: str | None = Field(default=None, max_length=5000)
    source: str | None = Field(default=None, max_length=32)
    location: str | None = Field(default=None, max_length=255)
    payload_json: dict | list | None = None
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
    provider_reference: str | None = Field(default=None, max_length=255)
    shipping_rule_id: int | None = None
    shipping_rule_name: str | None = Field(default=None, max_length=120)
    detected_zone: str | None = Field(default=None, max_length=120)
    resolution_mode: str | None = Field(default=None, max_length=32)
    shipping_type_code: str | None = Field(default=None, max_length=32)
    weight_tier_code: str | None = Field(default=None, max_length=64)
    weight_tier_label: str | None = Field(default=None, max_length=120)
    shipping_weight_declared: float | None = None
    package_count: int | None = Field(default=None, ge=1)
    provider_payload_json: dict | list | None = None
    label_created_at: datetime | None = None
    shopify_sync_status: str | None = Field(default=None, max_length=32)
    shopify_sync_error: str | None = Field(default=None, max_length=5000)
    shopify_last_sync_attempt_at: datetime | None = None
    shopify_synced_at: datetime | None = None


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
    provider_reference: str | None
    shipping_rule_id: int | None
    shipping_rule_name: str | None
    detected_zone: str | None
    resolution_mode: str | None
    shipping_type_code: str | None
    weight_tier_code: str | None
    weight_tier_label: str | None
    shipping_weight_declared: float | None
    package_count: int | None
    provider_payload_json: dict | list | None
    label_created_at: datetime | None
    shopify_sync_status: str | None
    shopify_sync_error: str | None
    shopify_last_sync_attempt_at: datetime | None
    shopify_synced_at: datetime | None
    public_token: str
    created_at: datetime
    events: list[TrackingEventRead] = Field(default_factory=list)


class ShipmentTrackingSyncRead(BaseModel):
    shipment: ShipmentRead
    changed: bool
    events_created: int
    latest_status: str | None
    latest_raw_status: str | None
    shopify_sync_status: str | None


class ShipmentTrackingBatchSyncRead(BaseModel):
    synced_count: int
    changed_count: int
    events_created: int
    shipments: list[ShipmentTrackingSyncRead] = Field(default_factory=list)
