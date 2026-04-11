from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.invoice import InvoiceStatus


class InvoiceItemCreate(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit_price: Decimal = Field(ge=0)
    sort_order: int = 0


class InvoiceItemRead(InvoiceItemCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_id: int

    @property
    def line_total(self) -> Decimal:
        return self.quantity * self.unit_price


class InvoiceCreate(BaseModel):
    shop_id: int | None = None
    client_name: str = Field(min_length=1, max_length=255)
    client_email: str = Field(min_length=3, max_length=320)
    client_company: str | None = Field(default=None, max_length=255)
    client_tax_id: str | None = Field(default=None, max_length=64)
    client_address: str | None = None
    sender_name: str | None = Field(default=None, max_length=255)
    sender_tax_id: str | None = Field(default=None, max_length=64)
    sender_address: str | None = None
    currency: str = Field(default="EUR", max_length=8)
    tax_rate: Decimal = Field(default=Decimal("21.00"), ge=0, le=100)
    notes: str | None = None
    payment_terms: str | None = Field(default=None, max_length=120)
    issue_date: date
    due_date: date | None = None
    items: list[InvoiceItemCreate] = Field(default_factory=list)


class InvoiceUpdate(BaseModel):
    shop_id: int | None = None
    client_name: str | None = Field(default=None, min_length=1, max_length=255)
    client_email: str | None = Field(default=None, min_length=3, max_length=320)
    client_company: str | None = Field(default=None, max_length=255)
    client_tax_id: str | None = Field(default=None, max_length=64)
    client_address: str | None = None
    sender_name: str | None = Field(default=None, max_length=255)
    sender_tax_id: str | None = Field(default=None, max_length=64)
    sender_address: str | None = None
    currency: str | None = Field(default=None, max_length=8)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None
    payment_terms: str | None = Field(default=None, max_length=120)
    issue_date: date | None = None
    due_date: date | None = None
    items: list[InvoiceItemCreate] | None = None


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_number: str
    shop_id: int | None
    status: InvoiceStatus
    client_name: str
    client_email: str
    client_company: str | None
    client_tax_id: str | None
    client_address: str | None
    sender_name: str | None
    sender_tax_id: str | None
    sender_address: str | None
    currency: str
    tax_rate: Decimal
    notes: str | None
    payment_terms: str | None
    issue_date: date
    due_date: date | None
    sent_at: datetime | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime
    items: list[InvoiceItemRead]
    subtotal: Decimal
    tax_amount: Decimal
    total: Decimal


class InvoiceSendRequest(BaseModel):
    """Optional overrides for the email send action."""
    recipient_email: str | None = Field(default=None, max_length=320)
    subject: str | None = Field(default=None, max_length=255)
    message: str | None = None
