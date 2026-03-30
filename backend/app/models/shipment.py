import secrets
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


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
    fulfillment_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    carrier: Mapped[str] = mapped_column(String(120))
    tracking_number: Mapped[str] = mapped_column(String(255))
    tracking_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    shipping_status: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shipping_status_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    events = relationship(
        "TrackingEvent",
        back_populates="shipment",
        cascade="all, delete-orphan",
        order_by="desc(TrackingEvent.occurred_at), desc(TrackingEvent.id)",
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
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    shipment = relationship("Shipment", back_populates="events")
