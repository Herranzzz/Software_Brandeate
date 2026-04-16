"""Pydantic schemas for PurchaseOrder + PurchaseOrderLine + Replenishment."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# PurchaseOrderLine
# ---------------------------------------------------------------------------

class PurchaseOrderLineBase(BaseModel):
    inventory_item_id: int | None = None
    sku: str
    name: str | None = None
    supplier_sku: str | None = None
    quantity_ordered: int = 0
    unit_cost: Decimal = Decimal("0")
    notes: str | None = None


class PurchaseOrderLineCreate(PurchaseOrderLineBase):
    pass


class PurchaseOrderLineUpdate(BaseModel):
    inventory_item_id: int | None = None
    sku: str | None = None
    name: str | None = None
    supplier_sku: str | None = None
    quantity_ordered: int | None = None
    quantity_received: int | None = None
    quantity_cancelled: int | None = None
    unit_cost: Decimal | None = None
    notes: str | None = None


class PurchaseOrderLineRead(PurchaseOrderLineBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    purchase_order_id: int
    quantity_received: int
    quantity_cancelled: int
    total_cost: Decimal


# ---------------------------------------------------------------------------
# PurchaseOrder
# ---------------------------------------------------------------------------

class PurchaseOrderBase(BaseModel):
    supplier_id: int
    expected_arrival_date: str | None = None
    notes: str | None = None
    supplier_reference: str | None = None
    currency: str = "EUR"
    tax_amount: Decimal = Decimal("0")
    shipping_cost: Decimal = Decimal("0")


class PurchaseOrderCreate(PurchaseOrderBase):
    shop_id: int
    lines: list[PurchaseOrderLineCreate] = []


class PurchaseOrderUpdate(BaseModel):
    supplier_id: int | None = None
    expected_arrival_date: str | None = None
    notes: str | None = None
    supplier_reference: str | None = None
    currency: str | None = None
    tax_amount: Decimal | None = None
    shipping_cost: Decimal | None = None


class PurchaseOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    supplier_id: int
    supplier_name: str | None = None
    po_number: str
    status: str
    expected_arrival_date: str | None = None
    sent_at: datetime | None = None
    confirmed_at: datetime | None = None
    first_received_at: datetime | None = None
    fully_received_at: datetime | None = None
    cancelled_at: datetime | None = None
    subtotal: Decimal
    tax_amount: Decimal
    shipping_cost: Decimal
    total: Decimal
    currency: str
    notes: str | None = None
    supplier_reference: str | None = None
    created_by_user_id: int | None = None
    inbound_shipment_id: int | None = None
    auto_generated: bool
    created_at: datetime
    updated_at: datetime
    lines: list[PurchaseOrderLineRead] = []
    total_quantity_ordered: int = 0
    total_quantity_received: int = 0

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(
            self,
            "total_quantity_ordered",
            sum(l.quantity_ordered for l in self.lines),
        )
        object.__setattr__(
            self,
            "total_quantity_received",
            sum(l.quantity_received for l in self.lines),
        )
        if not self.supplier_name and __context is not None:
            pass


class PurchaseOrderListResponse(BaseModel):
    purchase_orders: list[PurchaseOrderRead]
    total: int


class PurchaseOrderStatusTransition(BaseModel):
    status: str  # draft | sent | confirmed | partially_received | received | cancelled
    notes: str | None = None


class ReceivePOLinePayload(BaseModel):
    line_id: int
    quantity_received: int


class ReceivePOPayload(BaseModel):
    lines: list[ReceivePOLinePayload]
    notes: str | None = None


# ---------------------------------------------------------------------------
# Replenishment recommendations
# ---------------------------------------------------------------------------

class ReplenishmentRecommendation(BaseModel):
    inventory_item_id: int
    shop_id: int
    sku: str
    name: str
    stock_on_hand: int
    stock_reserved: int
    stock_available: int
    reorder_point: int | None = None
    computed_reorder_point: int
    daily_consumption_rate: float
    days_of_cover_remaining: float | None = None
    suggested_order_qty: int
    primary_supplier_id: int | None = None
    primary_supplier_name: str | None = None
    cost_price: Decimal | None = None
    lead_time_days: int
    urgency: str  # critical | high | medium | low
    reason: str


class ReplenishmentRecommendationsResponse(BaseModel):
    recommendations: list[ReplenishmentRecommendation]
    total: int
    shop_id: int | None = None


class ReplenishmentGenerateRequest(BaseModel):
    shop_id: int
    inventory_item_ids: list[int] | None = None  # None = all auto-enabled items


class ReplenishmentGenerateResponse(BaseModel):
    purchase_orders_created: int
    purchase_order_ids: list[int]
    items_skipped_no_supplier: int
    items_no_consumption: int
    total_items_evaluated: int
