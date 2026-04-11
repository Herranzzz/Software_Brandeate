import enum
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class InvoiceStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"
    cancelled = "cancelled"


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[InvoiceStatus] = mapped_column(
        PGEnum(InvoiceStatus, name="invoice_status", create_type=False),
        nullable=False,
        server_default=InvoiceStatus.draft.value,
    )

    # Client info (denormalized so invoice is immutable after send)
    client_name: Mapped[str] = mapped_column(String(255))
    client_email: Mapped[str] = mapped_column(String(320))
    client_company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_tax_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Sender (Brandeate) info
    sender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_tax_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sender_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Financial
    currency: Mapped[str] = mapped_column(String(8), server_default="EUR")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="21.00")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Dates
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    items: Mapped[list["InvoiceItem"]] = relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceItem.sort_order, InvoiceItem.id",
    )
    shop: Mapped["Shop | None"] = relationship("Shop")  # type: ignore[name-defined]

    @property
    def subtotal(self) -> Decimal:
        return sum(
            (item.quantity * item.unit_price for item in self.items),
            Decimal("0"),
        )

    @property
    def tax_amount(self) -> Decimal:
        return (self.subtotal * self.tax_rate / Decimal("100")).quantize(Decimal("0.01"))

    @property
    def total(self) -> Decimal:
        return self.subtotal + self.tax_amount


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), server_default="1.000")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")

    invoice: Mapped[Invoice] = relationship("Invoice", back_populates="items")
