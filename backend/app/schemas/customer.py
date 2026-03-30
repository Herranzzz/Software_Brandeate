from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ShopCustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    provider: str
    external_customer_id: str
    first_name: str | None
    last_name: str | None
    name: str | None
    email: str | None
    phone: str | None
    tags_json: list[str] | None
    default_address_json: dict | None
    total_orders: int | None
    last_order_at: datetime | None
    synced_at: datetime | None
    created_at: datetime


class ShopCustomerListResponse(BaseModel):
    customers: list[ShopCustomerRead]
