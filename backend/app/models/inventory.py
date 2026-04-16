"""Inventory SGA — InventoryItem, InboundShipment, InboundShipmentLine, StockMovement"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("shop_id", "sku", name="uq_inventory_items_shop_sku"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255))
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("shop_catalog_variants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    stock_on_hand: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    stock_reserved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reorder_point: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reorder_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    # ── SGA replenishment config ─────────────────────────────────────────────
    primary_supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    replenishment_auto_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    target_days_of_cover: Mapped[int] = mapped_column(
        Integer, default=30, server_default="30"
    )
    safety_stock_days: Mapped[int] = mapped_column(
        Integer, default=7, server_default="7"
    )
    consumption_lookback_days: Mapped[int] = mapped_column(
        Integer, default=60, server_default="60"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    shop = relationship("Shop")
    variant = relationship("ShopCatalogVariant")
    primary_supplier = relationship("Supplier", foreign_keys=[primary_supplier_id])
    supplier_products = relationship(
        "SupplierProduct",
        back_populates="inventory_item",
        cascade="all, delete-orphan",
    )
    movements = relationship(
        "StockMovement",
        back_populates="inventory_item",
        cascade="all, delete-orphan",
        order_by="desc(StockMovement.created_at)",
    )
    inbound_lines = relationship(
        "InboundShipmentLine",
        back_populates="inventory_item",
    )


class InboundShipment(Base):
    __tablename__ = "inbound_shipments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    reference: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="draft", server_default="draft", index=True)
    expected_arrival: Mapped[str | None] = mapped_column(String(10), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    received_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    shop = relationship("Shop")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    received_by = relationship("User", foreign_keys=[received_by_user_id])
    lines = relationship(
        "InboundShipmentLine",
        back_populates="shipment",
        cascade="all, delete-orphan",
        order_by="InboundShipmentLine.id",
    )


class InboundShipmentLine(Base):
    __tablename__ = "inbound_shipment_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inbound_shipment_id: Mapped[int] = mapped_column(
        ForeignKey("inbound_shipments.id", ondelete="CASCADE"), index=True
    )
    inventory_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sku: Mapped[str] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    qty_expected: Mapped[int] = mapped_column(Integer, default=0)
    qty_received: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    qty_accepted: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    qty_rejected: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    shipment = relationship("InboundShipment", back_populates="lines")
    inventory_item = relationship("InventoryItem", back_populates="inbound_lines")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    inventory_item_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(255), index=True)
    movement_type: Mapped[str] = mapped_column(String(32), index=True)
    qty_delta: Mapped[int] = mapped_column(Integer)
    qty_before: Mapped[int] = mapped_column(Integer)
    qty_after: Mapped[int] = mapped_column(Integer)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    shop = relationship("Shop")
    inventory_item = relationship("InventoryItem", back_populates="movements")
    performed_by = relationship("User", foreign_keys=[performed_by_user_id])
