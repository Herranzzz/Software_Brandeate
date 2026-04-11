"""Pydantic v2 schemas for the Inventory SGA module."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


# ---------------------------------------------------------------------------
# InventoryItem
# ---------------------------------------------------------------------------

class InventoryItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    sku: str
    name: str
    variant_id: int | None = None
    stock_on_hand: int
    stock_reserved: int
    stock_available: int = 0  # computed in model_post_init
    reorder_point: int | None = None
    reorder_qty: int | None = None
    location: str | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "stock_available", self.stock_on_hand - self.stock_reserved)


class InventoryItemCreate(BaseModel):
    shop_id: int
    sku: str
    name: str
    variant_id: int | None = None
    stock_on_hand: int = 0
    reorder_point: int | None = None
    reorder_qty: int | None = None
    location: str | None = None
    notes: str | None = None


class InventoryItemUpdate(BaseModel):
    name: str | None = None
    reorder_point: int | None = None
    reorder_qty: int | None = None
    location: str | None = None
    notes: str | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Stock adjustment
# ---------------------------------------------------------------------------

_ALLOWED_ADJUSTMENT_TYPES = frozenset({
    "adjustment_add",
    "adjustment_remove",
    "damage_write_off",
    "cycle_count",
    "return_receipt",
})


class StockAdjustPayload(BaseModel):
    qty_delta: int
    movement_type: str
    notes: str | None = None

    @field_validator("qty_delta")
    @classmethod
    def qty_delta_nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("qty_delta must be non-zero")
        return v

    @field_validator("movement_type")
    @classmethod
    def movement_type_allowed(cls, v: str) -> str:
        if v not in _ALLOWED_ADJUSTMENT_TYPES:
            raise ValueError(
                f"movement_type must be one of: {', '.join(sorted(_ALLOWED_ADJUSTMENT_TYPES))}"
            )
        return v


# ---------------------------------------------------------------------------
# InboundShipmentLine
# ---------------------------------------------------------------------------

class InboundShipmentLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inbound_shipment_id: int
    inventory_item_id: int | None = None
    sku: str
    name: str | None = None
    qty_expected: int
    qty_received: int
    qty_accepted: int
    qty_rejected: int
    rejection_reason: str | None = None
    notes: str | None = None
    inventory_item: InventoryItemRead | None = None


class InboundShipmentLineCreate(BaseModel):
    sku: str
    name: str | None = None
    qty_expected: int
    notes: str | None = None


class InboundShipmentLineUpdate(BaseModel):
    qty_expected: int | None = None
    qty_received: int | None = None
    qty_accepted: int | None = None
    qty_rejected: int | None = None
    rejection_reason: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# InboundShipment
# ---------------------------------------------------------------------------

class InboundShipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    reference: str
    status: str
    expected_arrival: str | None = None
    carrier: str | None = None
    tracking_number: str | None = None
    notes: str | None = None
    created_by_user_id: int | None = None
    received_by_user_id: int | None = None
    received_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    lines: list[InboundShipmentLineRead] = []
    total_expected: int = 0  # computed in model_post_init
    total_received: int = 0  # computed in model_post_init

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "total_expected", sum(line.qty_expected for line in self.lines))
        object.__setattr__(self, "total_received", sum(line.qty_received for line in self.lines))


class InboundShipmentCreate(BaseModel):
    shop_id: int
    reference: str
    status: str = "draft"
    expected_arrival: str | None = None
    carrier: str | None = None
    tracking_number: str | None = None
    notes: str | None = None


class InboundShipmentUpdate(BaseModel):
    reference: str | None = None
    status: str | None = None
    expected_arrival: str | None = None
    carrier: str | None = None
    tracking_number: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Receive payload
# ---------------------------------------------------------------------------

class ReceiveLinePayload(BaseModel):
    line_id: int
    qty_received: int
    qty_accepted: int
    qty_rejected: int
    rejection_reason: str | None = None


class InboundReceivePayload(BaseModel):
    lines: list[ReceiveLinePayload]
    notes: str | None = None


# ---------------------------------------------------------------------------
# StockMovement
# ---------------------------------------------------------------------------

class StockMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    inventory_item_id: int
    sku: str
    movement_type: str
    qty_delta: int
    qty_before: int
    qty_after: int
    reference_type: str | None = None
    reference_id: int | None = None
    notes: str | None = None
    performed_by_user_id: int | None = None
    created_at: datetime
    performed_by_name: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _extract_performed_by_name(cls, data: Any) -> Any:
        # When constructed from an ORM object, resolve performed_by_name from
        # the loaded relationship (if present).
        if hasattr(data, "__class__") and hasattr(data, "performed_by"):
            try:
                performed_by = data.performed_by
                if performed_by is not None:
                    name = getattr(performed_by, "name", None)
                    # Build a dict-like proxy the normal model init can consume
                    raw: dict[str, Any] = {
                        col.key: getattr(data, col.key)
                        for col in data.__class__.__table__.columns
                    }
                    raw["performed_by_name"] = name
                    return raw
            except Exception:
                pass
        return data


# ---------------------------------------------------------------------------
# Alerts & list responses
# ---------------------------------------------------------------------------

class InventoryAlertsRead(BaseModel):
    items: list[InventoryItemRead]
    total: int


class InventoryItemListResponse(BaseModel):
    items: list[InventoryItemRead]
    total: int


class InboundShipmentListResponse(BaseModel):
    shipments: list[InboundShipmentRead]
    total: int


class StockMovementListResponse(BaseModel):
    movements: list[StockMovementRead]
    total: int
