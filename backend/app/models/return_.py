from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ReturnStatus(str, enum.Enum):
    requested = "requested"
    approved = "approved"
    in_transit = "in_transit"
    received = "received"
    closed = "closed"
    rejected = "rejected"


class ReturnReason(str, enum.Enum):
    damaged = "damaged"
    wrong_product = "wrong_product"
    not_delivered = "not_delivered"
    address_issue = "address_issue"
    personalization_error = "personalization_error"
    changed_mind = "changed_mind"
    other = "other"


class Return(Base):
    __tablename__ = "returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[ReturnReason] = mapped_column(
        Enum(ReturnReason, name="return_reason", native_enum=False, create_constraint=True, validate_strings=True),
        default=ReturnReason.other,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReturnStatus] = mapped_column(
        Enum(ReturnStatus, name="return_status", native_enum=False, create_constraint=True, validate_strings=True),
        default=ReturnStatus.requested,
    )
    tracking_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    inspection_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    shop = relationship("Shop", foreign_keys=[shop_id])
    order = relationship("Order", foreign_keys=[order_id])
