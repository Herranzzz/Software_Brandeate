from pydantic import BaseModel, Field

from app.schemas.shipment import ShipmentRead


class CTTShippingItem(BaseModel):
    item_weight_declared: float
    item_length_declared: float | None = None
    item_width_declared: float | None = None
    item_height_declared: float | None = None


class CTTCreateShippingRequest(BaseModel):
    order_id: int
    recipient_name: str | None = None
    recipient_country_code: str | None = "ES"
    recipient_postal_code: str | None = None
    recipient_address: str | None = None
    recipient_town: str | None = None
    recipient_phones: list[str] = Field(default_factory=list)
    recipient_email: str | None = None
    shipping_weight_declared: float | None = None
    weight_tier_code: str | None = None
    item_count: int = 1
    shipping_type_code: str | None = None
    shipping_rule_id: int | None = None
    shipping_rule_name: str | None = None
    detected_zone: str | None = None
    resolution_mode: str | None = "automatic"
    shipping_date: str | None = None
    items: list[CTTShippingItem] | None = None


class CTTCreateShippingResponse(BaseModel):
    shipping_code: str
    tracking_url: str | None = None
    shopify_sync_status: str | None = None
    shipment: ShipmentRead | None = None
    ctt_response: dict
