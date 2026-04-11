from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import DesignStatus, DeliveryType, OrderItem, OrderPriority, OrderStatus, ProductionStatus
from app.schemas.automation import AutomationEventRead
from app.schemas.shipment import ShipmentRead, ShipmentSummaryRead


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


class OrderItemListRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    product_id: str | None
    variant_id: str | None
    sku: str
    name: str
    title: str | None
    variant_title: str | None
    quantity: int
    design_link: str | None
    customization_provider: str | None = None
    design_status: DesignStatus | None = None
    personalization_assets_json: list[dict] | dict | None = None
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
    shipping_name: str | None = Field(default=None, max_length=255)
    shipping_phone: str | None = Field(default=None, max_length=64)
    shipping_country_code: str | None = Field(default=None, max_length=8)
    shipping_postal_code: str | None = Field(default=None, max_length=32)
    shipping_address_line1: str | None = Field(default=None, max_length=255)
    shipping_address_line2: str | None = Field(default=None, max_length=255)
    shipping_town: str | None = Field(default=None, max_length=120)
    shipping_province_code: str | None = Field(default=None, max_length=32)
    shopify_shipping_snapshot_json: dict | list | None = None
    shopify_shipping_rate_name: str | None = Field(default=None, max_length=255)
    shopify_shipping_rate_amount: float | None = None
    shopify_shipping_rate_currency: str | None = Field(default=None, max_length=8)
    delivery_type: DeliveryType | None = None
    shipping_service_code: str | None = Field(default=None, max_length=64)
    shipping_service_name: str | None = Field(default=None, max_length=120)
    shipping_rate_amount: float | None = None
    shipping_rate_currency: str | None = Field(default=None, max_length=8)
    shipping_rate_estimated_days_min: int | None = None
    shipping_rate_estimated_days_max: int | None = None
    shipping_rate_quote_id: int | None = None
    pickup_point_json: dict | list | None = None
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


class AutomationFlagRead(BaseModel):
    key: str
    label: str
    tone: str
    description: str


class OrderListRead(BaseModel):
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
    shipping_name: str | None
    shipping_phone: str | None
    shipping_country_code: str | None
    shipping_postal_code: str | None
    shipping_address_line1: str | None
    shipping_address_line2: str | None
    shipping_town: str | None
    shipping_province_code: str | None
    shopify_shipping_snapshot_json: dict | list | None
    shopify_shipping_rate_name: str | None
    shopify_shipping_rate_amount: float | None
    shopify_shipping_rate_currency: str | None
    delivery_type: DeliveryType | None
    shipping_service_code: str | None
    shipping_service_name: str | None
    shipping_rate_amount: float | None
    shipping_rate_currency: str | None
    shipping_rate_estimated_days_min: int | None
    shipping_rate_estimated_days_max: int | None
    shipping_rate_quote_id: int | None
    pickup_point_json: dict | list | None
    note: str | None
    tags_json: list[str] | None
    channel: str | None
    shopify_financial_status: str | None
    shopify_fulfillment_status: str | None
    created_at: datetime
    prepared_by_employee_id: int | None = None
    prepared_at: datetime | None = None
    prepared_by_employee_name: str | None = None
    internal_note: str | None = None
    is_blocked: bool = False
    block_reason: str | None = None
    has_open_incident: bool
    open_incidents_count: int
    automation_flags: list["AutomationFlagRead"] = Field(default_factory=list)
    items: list[OrderItemListRead]
    shipment: ShipmentSummaryRead | None = None


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
    shipping_name: str | None
    shipping_phone: str | None
    shipping_country_code: str | None
    shipping_postal_code: str | None
    shipping_address_line1: str | None
    shipping_address_line2: str | None
    shipping_town: str | None
    shipping_province_code: str | None
    shopify_shipping_snapshot_json: dict | list | None
    shopify_shipping_rate_name: str | None
    shopify_shipping_rate_amount: float | None
    shopify_shipping_rate_currency: str | None
    delivery_type: DeliveryType | None
    shipping_service_code: str | None
    shipping_service_name: str | None
    shipping_rate_amount: float | None
    shipping_rate_currency: str | None
    shipping_rate_estimated_days_min: int | None
    shipping_rate_estimated_days_max: int | None
    shipping_rate_quote_id: int | None
    pickup_point_json: dict | list | None
    note: str | None
    tags_json: list[str] | None
    channel: str | None
    shopify_financial_status: str | None
    shopify_fulfillment_status: str | None
    fulfillment_orders_json: dict | list | None
    created_at: datetime
    prepared_by_employee_id: int | None = None
    prepared_at: datetime | None = None
    prepared_by_employee_name: str | None = None
    internal_note: str | None = None
    is_blocked: bool = False
    block_reason: str | None = None
    has_open_incident: bool
    open_incidents_count: int
    automation_flags: list["AutomationFlagRead"] = Field(default_factory=list)
    items: list[OrderItemRead]
    shipment: ShipmentRead | None = None


class OrderDetailRead(OrderRead):
    automation_events: list[AutomationEventRead] = Field(default_factory=list)


class OrderInternalNoteUpdate(BaseModel):
    internal_note: str | None = Field(default=None, max_length=10000)


class OrderBlockUpdate(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class OrderProductionStatusUpdate(BaseModel):
    production_status: ProductionStatus


class OrderPriorityUpdate(BaseModel):
    priority: OrderPriority


class OrderUpdate(BaseModel):
    shipping_name: str | None = Field(default=None, max_length=255)
    shipping_phone: str | None = Field(default=None, max_length=64)
    shipping_country_code: str | None = Field(default=None, max_length=8)
    shipping_postal_code: str | None = Field(default=None, max_length=32)
    shipping_address_line1: str | None = Field(default=None, max_length=255)
    shipping_address_line2: str | None = Field(default=None, max_length=255)
    shipping_town: str | None = Field(default=None, max_length=120)
    shipping_province_code: str | None = Field(default=None, max_length=32)
    shopify_shipping_rate_name: str | None = Field(default=None, max_length=255)
    shopify_shipping_rate_amount: float | None = None
    shopify_shipping_rate_currency: str | None = Field(default=None, max_length=8)
    delivery_type: DeliveryType | None = None
    shipping_service_code: str | None = Field(default=None, max_length=64)
    shipping_service_name: str | None = Field(default=None, max_length=120)
    shipping_rate_amount: float | None = None
    shipping_rate_currency: str | None = Field(default=None, max_length=8)
    shipping_rate_estimated_days_min: int | None = None
    shipping_rate_estimated_days_max: int | None = None
    shipping_rate_quote_id: int | None = None
    pickup_point_json: dict | list | None = None
