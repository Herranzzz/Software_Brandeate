"""Replenishment engine — compute consumption rates and generate purchase recommendations.

Algorithm:
    daily_rate = units_sold_last_N_days / N    (N = consumption_lookback_days)
    lead_time = item.lead_time_days or supplier.lead_time_days or 7
    reorder_point = (daily_rate * lead_time) + (daily_rate * safety_stock_days)
    target_stock = daily_rate * (lead_time + safety_stock_days + target_days_of_cover)
    suggested_order_qty = max(ceil(target_stock - stock_available), MOQ)

Orders are considered "consumed" when they are in a non-cancelled state.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    InventoryItem,
    Order,
    OrderItem,
    OrderStatus,
    Supplier,
    SupplierProduct,
)
from app.schemas.purchase_order import ReplenishmentRecommendation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Consumption calculation
# ---------------------------------------------------------------------------

_CONSUMED_ORDER_STATUSES = (
    OrderStatus.pending,
    OrderStatus.in_progress,
    OrderStatus.ready_to_ship,
    OrderStatus.shipped,
    OrderStatus.delivered,
)


def compute_daily_consumption(
    db: Session,
    shop_id: int,
    sku: str,
    lookback_days: int,
) -> float:
    """Return units-per-day for an SKU over the last `lookback_days`.

    Sums `quantity - refunded_quantity` over all non-cancelled orders in the
    window, then divides by lookback_days.
    """
    if lookback_days <= 0:
        return 0.0

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    total = db.scalar(
        select(
            func.coalesce(
                func.sum(OrderItem.quantity - OrderItem.refunded_quantity), 0
            )
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.shop_id == shop_id,
            Order.created_at >= cutoff,
            Order.status.in_(_CONSUMED_ORDER_STATUSES),
            OrderItem.sku == sku,
        )
    )
    total_units = int(total or 0)
    return total_units / lookback_days if total_units > 0 else 0.0


def _resolve_lead_time(item: InventoryItem, supplier: Supplier | None) -> int:
    if item.lead_time_days is not None and item.lead_time_days > 0:
        return item.lead_time_days
    if supplier is not None and supplier.lead_time_days > 0:
        return supplier.lead_time_days
    return 7


def _urgency_for_days_of_cover(days_remaining: float | None, lead_time: int) -> str:
    if days_remaining is None:
        return "low"
    if days_remaining <= 0:
        return "critical"
    if days_remaining <= lead_time / 2:
        return "high"
    if days_remaining <= lead_time:
        return "medium"
    return "low"


def compute_recommendation(
    db: Session,
    item: InventoryItem,
) -> ReplenishmentRecommendation | None:
    """Compute a recommendation for a single InventoryItem. Returns None if
    the item has no recent consumption AND stock_on_hand is above its
    (user-set or default) reorder_point — i.e. no action needed."""
    supplier: Supplier | None = None
    if item.primary_supplier_id is not None:
        supplier = db.get(Supplier, item.primary_supplier_id)

    lookback = item.consumption_lookback_days or 60
    daily_rate = compute_daily_consumption(db, item.shop_id, item.sku, lookback)
    lead_time = _resolve_lead_time(item, supplier)
    safety_days = item.safety_stock_days or 0
    target_days = item.target_days_of_cover or 30

    stock_available = item.stock_on_hand - item.stock_reserved

    # Computed reorder point (falls back to user-set if there's no consumption)
    if daily_rate > 0:
        computed_rp = int(math.ceil(daily_rate * (lead_time + safety_days)))
    elif item.reorder_point is not None:
        computed_rp = item.reorder_point
    else:
        computed_rp = 0

    effective_rp = max(
        computed_rp,
        item.reorder_point if item.reorder_point is not None else 0,
    )

    # No consumption AND no explicit reorder_point → skip
    if daily_rate == 0 and (item.reorder_point is None or stock_available > item.reorder_point):
        return None

    # Stock above reorder point → no replenishment needed
    if stock_available > effective_rp:
        return None

    # ── Suggested qty ───────────────────────────────────────────────────────
    if daily_rate > 0:
        target_stock = daily_rate * (lead_time + safety_days + target_days)
        suggested = int(math.ceil(target_stock - stock_available))
    elif item.reorder_qty:
        suggested = item.reorder_qty
    else:
        suggested = max(effective_rp - stock_available, 1)

    # Apply supplier MOQ & pack size if available
    supplier_product = None
    if supplier is not None:
        supplier_product = db.scalar(
            select(SupplierProduct).where(
                SupplierProduct.supplier_id == supplier.id,
                SupplierProduct.inventory_item_id == item.id,
                SupplierProduct.is_active.is_(True),
            )
        )
    moq = 1
    pack_size = 1
    cost_price = item.cost_price
    if supplier_product is not None:
        moq = max(1, supplier_product.moq)
        pack_size = max(1, supplier_product.pack_size)
        if supplier_product.cost_price is not None:
            cost_price = supplier_product.cost_price

    if suggested < moq:
        suggested = moq
    if pack_size > 1:
        suggested = int(math.ceil(suggested / pack_size)) * pack_size

    days_of_cover_remaining: float | None = None
    if daily_rate > 0:
        days_of_cover_remaining = round(stock_available / daily_rate, 1)

    urgency = _urgency_for_days_of_cover(days_of_cover_remaining, lead_time)

    if stock_available <= 0:
        reason = "Stock agotado"
    elif days_of_cover_remaining is not None:
        reason = f"Quedan {days_of_cover_remaining:.1f} días de cobertura"
    else:
        reason = "Stock por debajo del punto de reorden"

    return ReplenishmentRecommendation(
        inventory_item_id=item.id,
        shop_id=item.shop_id,
        sku=item.sku,
        name=item.name,
        stock_on_hand=item.stock_on_hand,
        stock_reserved=item.stock_reserved,
        stock_available=stock_available,
        reorder_point=item.reorder_point,
        computed_reorder_point=effective_rp,
        daily_consumption_rate=round(daily_rate, 3),
        days_of_cover_remaining=days_of_cover_remaining,
        suggested_order_qty=suggested,
        primary_supplier_id=item.primary_supplier_id,
        primary_supplier_name=supplier.name if supplier else None,
        cost_price=cost_price if cost_price is not None else None,
        lead_time_days=lead_time,
        urgency=urgency,
        reason=reason,
    )


def compute_recommendations_for_shop(
    db: Session,
    shop_id: int,
    only_auto_enabled: bool = False,
) -> list[ReplenishmentRecommendation]:
    """Compute replenishment recommendations for all active InventoryItems in a shop."""
    q = (
        select(InventoryItem)
        .options(joinedload(InventoryItem.primary_supplier))
        .where(
            InventoryItem.shop_id == shop_id,
            InventoryItem.is_active.is_(True),
        )
    )
    if only_auto_enabled:
        q = q.where(InventoryItem.replenishment_auto_enabled.is_(True))

    items = db.scalars(q).all()
    recs: list[ReplenishmentRecommendation] = []
    for item in items:
        rec = compute_recommendation(db, item)
        if rec is not None:
            recs.append(rec)

    urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    recs.sort(
        key=lambda r: (
            urgency_order.get(r.urgency, 99),
            r.days_of_cover_remaining if r.days_of_cover_remaining is not None else 9999,
        )
    )
    return recs


def compute_recommendations_for_scope(
    db: Session,
    shop_ids: list[int],
) -> list[ReplenishmentRecommendation]:
    """Compute recommendations across multiple shops."""
    out: list[ReplenishmentRecommendation] = []
    for sid in shop_ids:
        out.extend(compute_recommendations_for_shop(db, sid))
    urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(
        key=lambda r: (
            urgency_order.get(r.urgency, 99),
            r.days_of_cover_remaining if r.days_of_cover_remaining is not None else 9999,
        )
    )
    return out


__all__ = [
    "compute_daily_consumption",
    "compute_recommendation",
    "compute_recommendations_for_shop",
    "compute_recommendations_for_scope",
]
