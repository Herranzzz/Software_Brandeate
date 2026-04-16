"""Pydantic schemas for Supplier and SupplierProduct."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr


class SupplierBase(BaseModel):
    name: str
    email: EmailStr | None = None
    phone: str | None = None
    contact_name: str | None = None
    website: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    province: str | None = None
    postal_code: str | None = None
    country_code: str | None = None
    tax_id: str | None = None
    lead_time_days: int = 7
    payment_terms: str | None = None
    currency: str = "EUR"
    minimum_order_value: Decimal | None = None
    notes: str | None = None
    is_active: bool = True


class SupplierCreate(SupplierBase):
    shop_id: int


class SupplierUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    contact_name: str | None = None
    website: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    province: str | None = None
    postal_code: str | None = None
    country_code: str | None = None
    tax_id: str | None = None
    lead_time_days: int | None = None
    payment_terms: str | None = None
    currency: str | None = None
    minimum_order_value: Decimal | None = None
    notes: str | None = None
    is_active: bool | None = None


class SupplierRead(SupplierBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    created_at: datetime
    updated_at: datetime
    products_count: int = 0


class SupplierListResponse(BaseModel):
    suppliers: list[SupplierRead]
    total: int


# ---------------------------------------------------------------------------
# SupplierProduct
# ---------------------------------------------------------------------------

class SupplierProductBase(BaseModel):
    supplier_sku: str | None = None
    cost_price: Decimal | None = None
    currency: str = "EUR"
    moq: int = 1
    pack_size: int = 1
    lead_time_days_override: int | None = None
    is_primary: bool = False
    is_active: bool = True
    notes: str | None = None


class SupplierProductCreate(SupplierProductBase):
    supplier_id: int
    inventory_item_id: int


class SupplierProductUpdate(BaseModel):
    supplier_sku: str | None = None
    cost_price: Decimal | None = None
    currency: str | None = None
    moq: int | None = None
    pack_size: int | None = None
    lead_time_days_override: int | None = None
    is_primary: bool | None = None
    is_active: bool | None = None
    notes: str | None = None


class SupplierProductRead(SupplierProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    inventory_item_id: int
    inventory_item_sku: str | None = None
    inventory_item_name: str | None = None
    supplier_name: str | None = None
    created_at: datetime
    updated_at: datetime


class SupplierProductListResponse(BaseModel):
    products: list[SupplierProductRead]
    total: int
