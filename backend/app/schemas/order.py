from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import DesignStatus, OrderItem, OrderPriority, OrderStatus, ProductionStatus
from app.schemas.shipment import ShipmentRead


class OrderItemBase(BaseModel):
    shopify_line_item_gid: str | None = Field(default=None, max_length=255)
    product_id: str | None = Field(default=None, max_length=255)
    variant_id: str | None = Field(default=None, max_length=255)
    sku: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    title: str | None = Field(default=None, max_length=255)
    variant_title: str | None = Field(default=None, max_length=255)
    quantity: int = Field(ge=1)
    properties_json: dict | list | None = None
    customization_id: str | None = Field(default=None, max_length=255)
    design_link: str | None = Field(default=None, max_length=2048)
    customization_provider: str | None = Field(default=None, max_length=120)
    design_status: DesignStatus | None = None
    personalization_details_json: dict | list | None = None
    personalization_notes: str | None = Field(default=None, max_length=5000)
    personalization_assets_json: list[dict] | dict | None = None


class OrderItemCreate(OrderItemBase):
    def to_model(self) -> OrderItem:
        return OrderItem(**self.model_dump())


class OrderItemRead(OrderItemBase):
    model_config = ConfigDict(from_attributes=True)

    sku: str
    name: str
    customization_provider: str | None = None
    id: int
    order_id: int
    created_at: datetime


class OrderCreate(BaseModel):
    shop_id: int = Field(gt=0)
    external_id: str = Field(min_length=1, max_length=255)
    shopify_order_gid: str | None = Field(default=None, max_length=255)
    shopify_order_name: str | None = Field(default=None, max_length=255)
    customer_external_id: str | None = Field(default=None, max_length=255)
    status: OrderStatus
    production_status: ProductionStatus = ProductionStatus.pending_personalization
    priority: OrderPriority = OrderPriority.normal
    is_personalized: bool | None = None
    customer_name: str = Field(min_length=1, max_length=255)
    customer_email: str = Field(min_length=3, max_length=320)
    note: str | None = Field(default=None, max_length=10000)
    tags_json: list[str] | None = None
    channel: str | None = Field(default=None, max_length=120)
    shopify_financial_status: str | None = Field(default=None, max_length=120)
    shopify_fulfillment_status: str | None = Field(default=None, max_length=120)
    fulfillment_orders_json: dict | list | None = None
    items: list[OrderItemCreate] = Field(default_factory=list)

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip()
        if "@" not in email:
            raise ValueError("customer_email must be a valid email")
        return email


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    external_id: str
    shopify_order_gid: str | None
    shopify_order_name: str | None
    customer_external_id: str | None
    status: OrderStatus
    production_status: ProductionStatus
    priority: OrderPriority
    is_personalized: bool
    customer_name: str
    customer_email: str
    note: str | None
    tags_json: list[str] | None
    channel: str | None
    shopify_financial_status: str | None
    shopify_fulfillment_status: str | None
    fulfillment_orders_json: dict | list | None
    created_at: datetime
    has_open_incident: bool
    open_incidents_count: int
    items: list[OrderItemRead]
    shipment: ShipmentRead | None = None


class OrderDetailRead(OrderRead):
    pass


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class OrderProductionStatusUpdate(BaseModel):
    production_status: ProductionStatus


class OrderPriorityUpdate(BaseModel):
    priority: OrderPriority
