from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


json_type = JSON().with_variant(JSONB, "postgresql")


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    shipping_settings_json: Mapped[dict | None] = mapped_column(json_type, nullable=True)
    tracking_config_json: Mapped[dict | None] = mapped_column(json_type, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    orders = relationship("Order", back_populates="shop", cascade="all, delete-orphan")
    integrations = relationship(
        "ShopIntegration",
        back_populates="shop",
        cascade="all, delete-orphan",
        order_by="desc(ShopIntegration.created_at), desc(ShopIntegration.id)",
    )
    sync_events = relationship(
        "ShopSyncEvent",
        back_populates="shop",
        cascade="all, delete-orphan",
        order_by="desc(ShopSyncEvent.started_at), desc(ShopSyncEvent.id)",
    )
    user_shops = relationship(
        "UserShop",
        back_populates="shop",
        cascade="all, delete-orphan",
        order_by="UserShop.id",
    )
    customers = relationship(
        "ShopCustomer",
        back_populates="shop",
        cascade="all, delete-orphan",
        order_by="desc(ShopCustomer.last_order_at), desc(ShopCustomer.id)",
    )
    automation_events = relationship(
        "AutomationEvent",
        back_populates="shop",
        cascade="all, delete-orphan",
        order_by="desc(AutomationEvent.created_at), desc(AutomationEvent.id)",
    )
