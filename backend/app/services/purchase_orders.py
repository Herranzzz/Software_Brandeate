"""Purchase order lifecycle service.

Responsibilities:
  - Generate PO number (per shop, sequential by year: PO-2026-0001)
  - Create draft POs from replenishment recommendations (grouped by supplier)
  - Transition PO status with side effects:
      sent         → creates InboundShipment (draft)
      received     → applies StockMovements, updates InventoryItem.stock_on_hand
      cancelled    → marks cancelled_at
  - Compute subtotal / total on create and line updates
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    InboundShipment,
    InboundShipmentLine,
    InventoryItem,
    PurchaseOrder,
    PurchaseOrderLine,
    StockMovement,
    Supplier,
    SupplierProduct,
)
from app.schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    ReceivePOPayload,
)
from app.schemas.purchase_order import ReplenishmentRecommendation

logger = logging.getLogger(__name__)


_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"sent", "cancelled"},
    "sent": {"confirmed", "partially_received", "received", "cancelled"},
    "confirmed": {"partially_received", "received", "cancelled"},
    "partially_received": {"received", "cancelled"},
    "received": set(),
    "cancelled": set(),
}


# ---------------------------------------------------------------------------
# PO number generator
# ---------------------------------------------------------------------------

def _next_po_number(db: Session, shop_id: int) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"PO-{year}-"
    count = db.scalar(
        select(func.count(PurchaseOrder.id)).where(
            PurchaseOrder.shop_id == shop_id,
            PurchaseOrder.po_number.like(f"{prefix}%"),
        )
    )
    return f"{prefix}{(count or 0) + 1:04d}"


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------

def _recalc_totals(po: PurchaseOrder) -> None:
    subtotal = Decimal("0")
    for line in po.lines:
        line.total_cost = (line.unit_cost or Decimal("0")) * Decimal(line.quantity_ordered or 0)
        subtotal += line.total_cost
    po.subtotal = subtotal
    po.total = subtotal + (po.tax_amount or Decimal("0")) + (po.shipping_cost or Decimal("0"))


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_purchase_order(
    db: Session,
    payload: PurchaseOrderCreate,
    *,
    created_by_user_id: int | None = None,
    auto_generated: bool = False,
) -> PurchaseOrder:
    supplier = db.get(Supplier, payload.supplier_id)
    if supplier is None or supplier.shop_id != payload.shop_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Supplier not found for this shop",
        )

    po = PurchaseOrder(
        shop_id=payload.shop_id,
        supplier_id=payload.supplier_id,
        po_number=_next_po_number(db, payload.shop_id),
        status="draft",
        expected_arrival_date=payload.expected_arrival_date,
        notes=payload.notes,
        supplier_reference=payload.supplier_reference,
        currency=payload.currency or supplier.currency or "EUR",
        tax_amount=payload.tax_amount or Decimal("0"),
        shipping_cost=payload.shipping_cost or Decimal("0"),
        created_by_user_id=created_by_user_id,
        auto_generated=auto_generated,
    )
    db.add(po)
    db.flush()

    for line_payload in payload.lines:
        _add_line(db, po, line_payload)

    _recalc_totals(po)
    db.flush()
    return po


def _add_line(
    db: Session,
    po: PurchaseOrder,
    payload: PurchaseOrderLineCreate,
) -> PurchaseOrderLine:
    line = PurchaseOrderLine(
        purchase_order_id=po.id,
        inventory_item_id=payload.inventory_item_id,
        sku=payload.sku,
        name=payload.name,
        supplier_sku=payload.supplier_sku,
        quantity_ordered=payload.quantity_ordered,
        unit_cost=payload.unit_cost or Decimal("0"),
        notes=payload.notes,
    )
    line.total_cost = line.unit_cost * Decimal(line.quantity_ordered)
    db.add(line)
    po.lines.append(line)
    return line


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------

def _validate_transition(current: str, new: str) -> None:
    allowed = _TRANSITIONS.get(current, set())
    if new not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot transition PO from '{current}' to '{new}'",
        )


def transition_po_status(
    db: Session,
    po: PurchaseOrder,
    new_status: str,
    *,
    user_id: int | None = None,
) -> PurchaseOrder:
    _validate_transition(po.status, new_status)

    now = datetime.now(timezone.utc)

    if new_status == "sent":
        po.sent_at = now
        # Auto-create the InboundShipment placeholder so receiving is ready
        if po.inbound_shipment_id is None:
            shipment = InboundShipment(
                shop_id=po.shop_id,
                reference=f"PO {po.po_number}",
                status="sent",
                expected_arrival=po.expected_arrival_date,
                notes=f"Auto-created from PO {po.po_number}",
                created_by_user_id=user_id,
            )
            db.add(shipment)
            db.flush()
            for line in po.lines:
                isl = InboundShipmentLine(
                    inbound_shipment_id=shipment.id,
                    inventory_item_id=line.inventory_item_id,
                    sku=line.sku,
                    name=line.name,
                    qty_expected=line.quantity_ordered,
                )
                db.add(isl)
            po.inbound_shipment_id = shipment.id

    elif new_status == "confirmed":
        po.confirmed_at = now

    elif new_status == "cancelled":
        po.cancelled_at = now

    elif new_status in ("partially_received", "received"):
        # Full-receipt transition via explicit status change: if lines still
        # have pending qty, receive the remainder.
        pending_lines = [
            l for l in po.lines
            if l.quantity_received + l.quantity_cancelled < l.quantity_ordered
        ]
        if new_status == "received" and pending_lines:
            for line in pending_lines:
                remaining = line.quantity_ordered - line.quantity_received - line.quantity_cancelled
                if remaining > 0:
                    _apply_receipt(db, po, line, remaining, user_id)
            po.fully_received_at = now
        else:
            if po.first_received_at is None:
                po.first_received_at = now

    po.status = new_status
    po.updated_at = now
    return po


def receive_purchase_order(
    db: Session,
    po: PurchaseOrder,
    payload: ReceivePOPayload,
    *,
    user_id: int | None = None,
) -> PurchaseOrder:
    if po.status not in ("sent", "confirmed", "partially_received"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="PO must be in sent/confirmed/partially_received to receive",
        )

    lines_by_id: dict[int, PurchaseOrderLine] = {l.id: l for l in po.lines}
    any_received = False

    for rcv in payload.lines:
        line = lines_by_id.get(rcv.line_id)
        if line is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Line {rcv.line_id} not found in PO {po.id}",
            )
        if rcv.quantity_received <= 0:
            continue
        remaining = line.quantity_ordered - line.quantity_received - line.quantity_cancelled
        qty = min(rcv.quantity_received, remaining)
        if qty <= 0:
            continue
        _apply_receipt(db, po, line, qty, user_id)
        any_received = True

    if not any_received:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No quantities received",
        )

    now = datetime.now(timezone.utc)
    if po.first_received_at is None:
        po.first_received_at = now

    # Determine new status
    total_pending = sum(
        (l.quantity_ordered - l.quantity_received - l.quantity_cancelled) for l in po.lines
    )
    if total_pending == 0:
        po.status = "received"
        po.fully_received_at = now
    else:
        po.status = "partially_received"
    po.updated_at = now

    if payload.notes:
        existing = po.notes or ""
        po.notes = f"{existing}\n[{now.isoformat()}] {payload.notes}".strip()

    return po


def _apply_receipt(
    db: Session,
    po: PurchaseOrder,
    line: PurchaseOrderLine,
    qty: int,
    user_id: int | None,
) -> None:
    """Apply a partial or full receipt to a PO line: update qty_received,
    create StockMovement, increment InventoryItem.stock_on_hand, and update
    the linked InboundShipmentLine if one exists."""
    if qty <= 0:
        return

    line.quantity_received += qty

    # Link to inventory item — create if missing
    item: InventoryItem | None = None
    if line.inventory_item_id is not None:
        item = db.get(InventoryItem, line.inventory_item_id)
    if item is None:
        item = db.scalar(
            select(InventoryItem).where(
                InventoryItem.shop_id == po.shop_id,
                InventoryItem.sku == line.sku,
            )
        )
        if item is None:
            item = InventoryItem(
                shop_id=po.shop_id,
                sku=line.sku,
                name=line.name or line.sku,
                stock_on_hand=0,
            )
            db.add(item)
            db.flush()
        line.inventory_item_id = item.id

    qty_before = item.stock_on_hand
    qty_after = qty_before + qty

    movement = StockMovement(
        shop_id=item.shop_id,
        inventory_item_id=item.id,
        sku=item.sku,
        movement_type="purchase_order_receipt",
        qty_delta=qty,
        qty_before=qty_before,
        qty_after=qty_after,
        reference_type="purchase_order",
        reference_id=po.id,
        notes=f"Receipt from PO {po.po_number}",
        performed_by_user_id=user_id,
    )
    db.add(movement)
    item.stock_on_hand = qty_after
    item.updated_at = datetime.now(timezone.utc)

    # If there's a linked inbound_shipment, mirror the receipt
    if po.inbound_shipment_id is not None:
        isl = db.scalar(
            select(InboundShipmentLine).where(
                InboundShipmentLine.inbound_shipment_id == po.inbound_shipment_id,
                InboundShipmentLine.sku == line.sku,
            )
        )
        if isl is not None:
            isl.qty_received += qty
            isl.qty_accepted += qty
            if isl.inventory_item_id is None:
                isl.inventory_item_id = item.id


# ---------------------------------------------------------------------------
# Auto-generate POs from recommendations
# ---------------------------------------------------------------------------

def generate_pos_from_recommendations(
    db: Session,
    shop_id: int,
    recommendations: list[ReplenishmentRecommendation],
    *,
    created_by_user_id: int | None = None,
    auto_generated: bool = True,
) -> list[PurchaseOrder]:
    """Group recommendations by primary_supplier_id and create one draft PO per supplier.

    Recommendations without a primary_supplier_id are skipped.
    """
    by_supplier: dict[int, list[ReplenishmentRecommendation]] = {}
    for rec in recommendations:
        if rec.primary_supplier_id is None or rec.suggested_order_qty <= 0:
            continue
        by_supplier.setdefault(rec.primary_supplier_id, []).append(rec)

    created_pos: list[PurchaseOrder] = []
    for supplier_id, recs in by_supplier.items():
        lines = [
            PurchaseOrderLineCreate(
                inventory_item_id=r.inventory_item_id,
                sku=r.sku,
                name=r.name,
                quantity_ordered=r.suggested_order_qty,
                unit_cost=r.cost_price or Decimal("0"),
            )
            for r in recs
        ]
        payload = PurchaseOrderCreate(
            shop_id=shop_id,
            supplier_id=supplier_id,
            lines=lines,
        )
        po = create_purchase_order(
            db,
            payload,
            created_by_user_id=created_by_user_id,
            auto_generated=auto_generated,
        )
        # Fill supplier_sku on each line if a SupplierProduct exists
        for line, rec in zip(po.lines, recs, strict=False):
            sp = db.scalar(
                select(SupplierProduct).where(
                    SupplierProduct.supplier_id == supplier_id,
                    SupplierProduct.inventory_item_id == rec.inventory_item_id,
                )
            )
            if sp is not None and sp.supplier_sku:
                line.supplier_sku = sp.supplier_sku
        created_pos.append(po)

    return created_pos


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

def load_po_with_lines(db: Session, po_id: int) -> PurchaseOrder | None:
    return db.scalar(
        select(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.lines),
            joinedload(PurchaseOrder.supplier),
        )
        .where(PurchaseOrder.id == po_id)
    )


__all__ = [
    "create_purchase_order",
    "transition_po_status",
    "receive_purchase_order",
    "generate_pos_from_recommendations",
    "load_po_with_lines",
]
