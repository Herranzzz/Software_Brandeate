"""Email marketing flow configuration and send log."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EmailFlowType(str, Enum):
    post_purchase = "post_purchase"
    shipping_update = "shipping_update"
    delivery = "delivery"
    abandon_cart = "abandon_cart"


class EmailFlowLogStatus(str, Enum):
    sent = "sent"
    failed = "failed"
    skipped = "skipped"


class EmailFlow(Base):
    __tablename__ = "email_flows"
    __table_args__ = (
        UniqueConstraint("shop_id", "flow_type", name="uq_email_flows_shop_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    flow_type: Mapped[str] = mapped_column(String(32), index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reply_to: Mapped[str | None] = mapped_column(String(320), nullable=True)
    subject_template: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    shop = relationship("Shop")
    logs = relationship(
        "EmailFlowLog",
        back_populates="flow",
        cascade="all, delete-orphan",
        order_by="desc(EmailFlowLog.sent_at)",
    )


class EmailFlowLog(Base):
    __tablename__ = "email_flow_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    flow_id: Mapped[int | None] = mapped_column(
        ForeignKey("email_flows.id", ondelete="SET NULL"), nullable=True, index=True
    )
    flow_type: Mapped[str] = mapped_column(String(32), index=True)
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="sent", index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    shop = relationship("Shop")
    flow = relationship("EmailFlow", back_populates="logs")
    order = relationship("Order")
