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


class CTTCreateAdhocShippingRequest(BaseModel):
    """Create an additional CTT label using an order as recipient template.

    Unlike CTTCreateShippingRequest, this endpoint does NOT attach the
    resulting shipment to the order's Shipment record — the order keeps its
    original shipment. Use this when you need to send another package to the
    same customer without going through CTT's external software.
    """

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
    shipping_date: str | None = None
    label_reference_suffix: str | None = None


class CTTCreateAdhocShippingResponse(BaseModel):
    shipping_code: str
    tracking_url: str | None = None
    ctt_response: dict


class CTTBulkShippingRequest(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=200)
    weight_tier_code: str | None = None
    shipping_type_code: str | None = None
    item_count: int = Field(default=1, ge=1, le=99)


class CTTBulkShippingResult(BaseModel):
    order_id: int
    external_id: str | None = None
    status: str  # "created" | "skipped" | "failed"
    reason: str | None = None
    shipping_code: str | None = None
    tracking_url: str | None = None


class CTTBulkShippingResponse(BaseModel):
    results: list[CTTBulkShippingResult]
    created_count: int
    skipped_count: int
    failed_count: int
