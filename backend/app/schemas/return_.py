from datetime import datetime

from pydantic import BaseModel

from app.models.return_ import ReturnReason, ReturnStatus


class ReturnOrderRead(BaseModel):
    id: int
    external_id: str
    customer_name: str
    customer_email: str


class ReturnRead(BaseModel):
    id: int
    shop_id: int
    order_id: int | None
    customer_name: str | None
    customer_email: str | None
    reason: str
    notes: str | None
    status: str
    tracking_number: str | None
    created_at: datetime
    updated_at: datetime
    order: ReturnOrderRead | None = None

    model_config = {"from_attributes": True}


class ReturnCreate(BaseModel):
    shop_id: int
    order_id: int | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    reason: ReturnReason = ReturnReason.other
    notes: str | None = None
    tracking_number: str | None = None


class ReturnUpdate(BaseModel):
    status: ReturnStatus | None = None
    notes: str | None = None
    tracking_number: str | None = None
    reason: ReturnReason | None = None
