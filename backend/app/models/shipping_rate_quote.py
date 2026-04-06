import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ShippingQuoteSource(str, enum.Enum):
    mock = "mock"
    ctt = "ctt"
    custom = "custom"


class ShippingRateQuote(Base):
    __tablename__ = "shipping_rate_quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    carrier: Mapped[str] = mapped_column(String(64))
    service_code: Mapped[str] = mapped_column(String(64))
    service_name: Mapped[str] = mapped_column(String(120))
    delivery_type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8))
    estimated_days_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_days_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_tier_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    destination_country_code: Mapped[str] = mapped_column(String(8))
    destination_postal_code: Mapped[str] = mapped_column(String(32))
    destination_city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_personalized: Mapped[bool | None] = mapped_column(nullable=True)
    source: Mapped[ShippingQuoteSource] = mapped_column(
        Enum(
            ShippingQuoteSource,
            name="shipping_quote_source",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        default=ShippingQuoteSource.mock,
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    order = relationship(
        "Order",
        back_populates="shipping_rate_quotes",
        foreign_keys=[order_id],
    )
    shop = relationship("Shop")
