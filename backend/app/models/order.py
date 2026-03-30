import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


class OrderStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    ready_to_ship = "ready_to_ship"
    shipped = "shipped"
    delivered = "delivered"
    exception = "exception"


class ProductionStatus(str, enum.Enum):
    pending_personalization = "pending_personalization"
    in_production = "in_production"
    packed = "packed"
    completed = "completed"


class DesignStatus(str, enum.Enum):
    design_available = "design_available"
    pending_asset = "pending_asset"
    missing_asset = "missing_asset"


class OrderPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


json_type = JSON().with_variant(JSONB, "postgresql")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("shop_id", "external_id", name="uq_orders_shop_external_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(255))
    shopify_order_gid: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    shopify_order_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[OrderStatus] = mapped_column(
        Enum(
            OrderStatus,
            name="order_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    production_status: Mapped[ProductionStatus] = mapped_column(
        Enum(
            ProductionStatus,
            name="production_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        default=ProductionStatus.pending_personalization,
    )
    priority: Mapped[OrderPriority] = mapped_column(
        Enum(
            OrderPriority,
            name="order_priority",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        nullable=False,
        default=OrderPriority.normal,
        server_default=OrderPriority.normal.value,
        index=True,
    )
    is_personalized: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    customer_name: Mapped[str] = mapped_column(String(255))
    customer_email: Mapped[str] = mapped_column(String(320))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list[str] | None] = mapped_column(json_type, nullable=True)
    channel: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shopify_financial_status: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shopify_fulfillment_status: Mapped[str | None] = mapped_column(String(120), nullable=True)
    fulfillment_orders_json: Mapped[list[dict] | dict | None] = mapped_column(json_type, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="orders")
    items = relationship(
        "OrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderItem.id",
    )
    shipment = relationship(
        "Shipment",
        back_populates="order",
        uselist=False,
        cascade="all, delete-orphan",
    )
    incidents = relationship(
        "Incident",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="desc(Incident.updated_at), desc(Incident.id)",
    )

    @property
    def open_incidents_count(self) -> int:
        return sum(1 for incident in self.incidents if getattr(incident.status, "value", incident.status) != "resolved")

    @property
    def has_open_incident(self) -> bool:
        return self.open_incidents_count > 0


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    shopify_line_item_gid: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    product_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    variant_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    variant_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    properties_json: Mapped[dict | list | None] = mapped_column(json_type, nullable=True)
    customization_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    design_link: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    customization_provider: Mapped[str | None] = mapped_column(String(120), nullable=True)
    design_status: Mapped[DesignStatus | None] = mapped_column(
        Enum(
            DesignStatus,
            name="design_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        nullable=True,
    )
    personalization_details_json: Mapped[dict | list | None] = mapped_column(
        json_type,
        nullable=True,
    )
    personalization_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    personalization_assets_json: Mapped[list[dict] | dict | None] = mapped_column(
        json_type,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    order = relationship("Order", back_populates="items")
