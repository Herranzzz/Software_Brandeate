import secrets
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


json_type = JSON().with_variant(JSONB, "postgresql")


def generate_public_token() -> str:
    return secrets.token_urlsafe(24)


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    created_by_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    fulfillment_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    carrier: Mapped[str] = mapped_column(String(120))
    tracking_number: Mapped[str] = mapped_column(String(255))
    tracking_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    shipping_status: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shipping_status_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_rule_id: Mapped[int | None] = mapped_column(ForeignKey("shipping_rules.id", ondelete="SET NULL"), nullable=True)
    shipping_rule_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    detected_zone: Mapped[str | None] = mapped_column(String(120), nullable=True)
    resolution_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    shipping_type_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    weight_tier_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    weight_tier_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shipping_weight_declared: Mapped[float | None] = mapped_column(Float, nullable=True)
    package_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_payload_json: Mapped[dict | list | None] = mapped_column(json_type, nullable=True)
    label_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shopify_sync_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    shopify_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    shopify_last_sync_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shopify_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    public_token: Mapped[str] = mapped_column(
        String(128),
        unique=True,
        index=True,
        default=generate_public_token,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    order = relationship("Order", back_populates="shipment")
    created_by_employee = relationship("User", back_populates="created_shipments", foreign_keys=[created_by_employee_id])
    shipping_rule = relationship("ShippingRule", back_populates="shipments")
    events = relationship(
        "TrackingEvent",
        back_populates="shipment",
        cascade="all, delete-orphan",
        order_by="desc(TrackingEvent.occurred_at), desc(TrackingEvent.id)",
    )
    automation_events = relationship(
        "AutomationEvent",
        back_populates="shipment",
        cascade="all, delete-orphan",
        order_by="desc(AutomationEvent.created_at), desc(AutomationEvent.id)",
    )


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shipment_id: Mapped[int] = mapped_column(
        ForeignKey("shipments.id", ondelete="CASCADE"),
        index=True,
    )
    status_norm: Mapped[str] = mapped_column(String(120))
    status_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload_json: Mapped[dict | list | None] = mapped_column(json_type, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    shipment = relationship("Shipment", back_populates="events")
