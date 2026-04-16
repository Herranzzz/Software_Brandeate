"""sga: suppliers, supplier_products, purchase_orders,
purchase_order_lines + replenishment columns on inventory_items

Revision ID: 0044_sga
Revises: 0043_marketing_email_flows
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0044_sga"
down_revision = "0043_marketing_email_flows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── suppliers ────────────────────────────────────────────────────────────
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("shop_id", sa.Integer, sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("contact_name", sa.String(255), nullable=True),
        sa.Column("website", sa.String(512), nullable=True),
        sa.Column("address_line1", sa.String(255), nullable=True),
        sa.Column("address_line2", sa.String(255), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("province", sa.String(120), nullable=True),
        sa.Column("postal_code", sa.String(32), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("tax_id", sa.String(64), nullable=True),
        sa.Column("lead_time_days", sa.Integer, nullable=False, server_default="7"),
        sa.Column("payment_terms", sa.String(120), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("minimum_order_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── inventory_items: replenishment columns ───────────────────────────────
    op.add_column(
        "inventory_items",
        sa.Column(
            "primary_supplier_id",
            sa.Integer,
            sa.ForeignKey("suppliers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_inventory_items_primary_supplier_id",
        "inventory_items",
        ["primary_supplier_id"],
    )
    op.add_column("inventory_items", sa.Column("cost_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("inventory_items", sa.Column("lead_time_days", sa.Integer, nullable=True))
    op.add_column(
        "inventory_items",
        sa.Column("replenishment_auto_enabled", sa.Boolean, nullable=False, server_default="false"),
    )
    op.add_column(
        "inventory_items",
        sa.Column("target_days_of_cover", sa.Integer, nullable=False, server_default="30"),
    )
    op.add_column(
        "inventory_items",
        sa.Column("safety_stock_days", sa.Integer, nullable=False, server_default="7"),
    )
    op.add_column(
        "inventory_items",
        sa.Column("consumption_lookback_days", sa.Integer, nullable=False, server_default="60"),
    )

    # ── supplier_products ────────────────────────────────────────────────────
    op.create_table(
        "supplier_products",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "supplier_id",
            sa.Integer,
            sa.ForeignKey("suppliers.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "inventory_item_id",
            sa.Integer,
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("supplier_sku", sa.String(255), nullable=True),
        sa.Column("cost_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("moq", sa.Integer, nullable=False, server_default="1"),
        sa.Column("pack_size", sa.Integer, nullable=False, server_default="1"),
        sa.Column("lead_time_days_override", sa.Integer, nullable=True),
        sa.Column("is_primary", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_supplier_products_supplier_item",
        "supplier_products",
        ["supplier_id", "inventory_item_id"],
    )

    # ── purchase_orders ──────────────────────────────────────────────────────
    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("shop_id", sa.Integer, sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("supplier_id", sa.Integer, sa.ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("po_number", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft", index=True),
        sa.Column("expected_arrival_date", sa.String(10), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fully_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("shipping_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("supplier_reference", sa.String(120), nullable=True),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "inbound_shipment_id",
            sa.Integer,
            sa.ForeignKey("inbound_shipments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("auto_generated", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_purchase_orders_shop_po_number", "purchase_orders", ["shop_id", "po_number"]
    )

    # ── purchase_order_lines ─────────────────────────────────────────────────
    op.create_table(
        "purchase_order_lines",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "purchase_order_id",
            sa.Integer,
            sa.ForeignKey("purchase_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "inventory_item_id",
            sa.Integer,
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("sku", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("supplier_sku", sa.String(255), nullable=True),
        sa.Column("quantity_ordered", sa.Integer, nullable=False, server_default="0"),
        sa.Column("quantity_received", sa.Integer, nullable=False, server_default="0"),
        sa.Column("quantity_cancelled", sa.Integer, nullable=False, server_default="0"),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("purchase_order_lines")
    op.drop_constraint("uq_purchase_orders_shop_po_number", "purchase_orders", type_="unique")
    op.drop_table("purchase_orders")
    op.drop_constraint(
        "uq_supplier_products_supplier_item", "supplier_products", type_="unique"
    )
    op.drop_table("supplier_products")

    op.drop_column("inventory_items", "consumption_lookback_days")
    op.drop_column("inventory_items", "safety_stock_days")
    op.drop_column("inventory_items", "target_days_of_cover")
    op.drop_column("inventory_items", "replenishment_auto_enabled")
    op.drop_column("inventory_items", "lead_time_days")
    op.drop_column("inventory_items", "cost_price")
    op.drop_index("ix_inventory_items_primary_supplier_id", table_name="inventory_items")
    op.drop_column("inventory_items", "primary_supplier_id")

    op.drop_table("suppliers")
