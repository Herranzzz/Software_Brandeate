from pydantic import BaseModel


class CTTShippingItem(BaseModel):
    item_weight_declared: float
    item_length_declared: float | None = None
    item_width_declared: float | None = None
    item_height_declared: float | None = None


class CTTCreateShippingRequest(BaseModel):
    order_id: int
    recipient_name: str
    recipient_country_code: str = "ES"
    recipient_postal_code: str
    recipient_address: str
    recipient_town: str
    recipient_phones: list[str]
    recipient_email: str | None = None
    shipping_weight_declared: float
    item_count: int = 1
    shipping_type_code: str | None = None
    shipping_date: str | None = None
    items: list[CTTShippingItem] | None = None


class CTTCreateShippingResponse(BaseModel):
    shipping_code: str
    ctt_response: dict
