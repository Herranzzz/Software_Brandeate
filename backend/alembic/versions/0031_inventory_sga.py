"""inventory_sga: create SGA tables for WMS (InventoryItem, InboundShipment, InboundShipmentLine, StockMovement)

Revision ID: 0031_inventory_sga
Revises: 0030_shopify_status_event
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_inventory_sga"
down_revision = "0030_shopify_status_event"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- inventory_items ---
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=True),
        sa.Column("stock_on_hand", sa.Integer(), server_default="0", nullable=False),
        sa.Column("stock_reserved", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reorder_point", sa.Integer(), nullable=True),
        sa.Column("reorder_qty", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["shop_catalog_variants.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("shop_id", "sku", name="uq_inventory_items_shop_sku"),
    )
    op.create_index("ix_inventory_items_shop_id", "inventory_items", ["shop_id"])
    op.create_index("ix_inventory_items_sku", "inventory_items", ["sku"])
    op.create_index("ix_inventory_items_variant_id", "inventory_items", ["variant_id"])

    # --- inbound_shipments ---
    op.create_table(
        "inbound_shipments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("reference", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), server_default="draft", nullable=False),
        sa.Column("expected_arrival", sa.String(10), nullable=True),
        sa.Column("carrier", sa.String(120), nullable=True),
        sa.Column("tracking_number", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("received_by_user_id", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["received_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_inbound_shipments_shop_id", "inbound_shipments", ["shop_id"])
    op.create_index("ix_inbound_shipments_status", "inbound_shipments", ["status"])

    # --- inbound_shipment_lines ---
    op.create_table(
        "inbound_shipment_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("inbound_shipment_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=True),
        sa.Column("sku", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("qty_expected", sa.Integer(), nullable=False),
        sa.Column("qty_received", sa.Integer(), server_default="0", nullable=False),
        sa.Column("qty_accepted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("qty_rejected", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["inbound_shipment_id"], ["inbound_shipments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"], ["inventory_items.id"], ondelete="SET NULL"
        ),
    )
    op.create_index(
        "ix_inbound_shipment_lines_shipment_id",
        "inbound_shipment_lines",
        ["inbound_shipment_id"],
    )
    op.create_index(
        "ix_inbound_shipment_lines_inventory_item_id",
        "inbound_shipment_lines",
        ["inventory_item_id"],
    )

    # --- stock_movements ---
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(255), nullable=False),
        sa.Column("movement_type", sa.String(32), nullable=False),
        sa.Column("qty_delta", sa.Integer(), nullable=False),
        sa.Column("qty_before", sa.Integer(), nullable=False),
        sa.Column("qty_after", sa.Integer(), nullable=False),
        sa.Column("reference_type", sa.String(50), nullable=True),
        sa.Column("reference_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("performed_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["performed_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_stock_movements_shop_id", "stock_movements", ["shop_id"])
    op.create_index("ix_stock_movements_inventory_item_id", "stock_movements", ["inventory_item_id"])
    op.create_index("ix_stock_movements_sku", "stock_movements", ["sku"])
    op.create_index("ix_stock_movements_movement_type", "stock_movements", ["movement_type"])


def downgrade() -> None:
    op.drop_table("stock_movements")
    op.drop_table("inbound_shipment_lines")
    op.drop_table("inbound_shipments")
    op.drop_table("inventory_items")
