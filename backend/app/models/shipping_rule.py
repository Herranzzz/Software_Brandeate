from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


json_type = JSON().with_variant(JSONB, "postgresql")


class ShippingRule(Base):
    __tablename__ = "shipping_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    zone_name: Mapped[str] = mapped_column(String(120))
    shipping_rate_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_rate_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    rule_type: Mapped[str] = mapped_column(String(32), default="price")
    min_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    carrier_service_code: Mapped[str] = mapped_column(String(64))
    carrier_service_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country_codes_json: Mapped[list[str] | None] = mapped_column(json_type, nullable=True)
    province_codes_json: Mapped[list[str] | None] = mapped_column(json_type, nullable=True)
    postal_code_patterns_json: Mapped[list[str] | None] = mapped_column(json_type, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    priority: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    shop = relationship("Shop")
    shipments = relationship(
        "Shipment",
        back_populates="shipping_rule",
        foreign_keys="Shipment.shipping_rule_id",
    )
