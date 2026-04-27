"""perf: indexes on hot columns (design_status, tracking_number)

Adds indexes to speed up:
- Order list filter "has_pending_asset" (subquery on OrderItem.design_status).
- Search by tracking number on shipments.

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-27
"""

from alembic import op


revision = "0031_perf_indexes"
down_revision = "0030_shopify_status_event"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_order_items_design_status",
        "order_items",
        ["design_status"],
    )
    op.create_index(
        "ix_order_items_order_id_design_status",
        "order_items",
        ["order_id", "design_status"],
    )
    op.create_index(
        "ix_shipments_tracking_number",
        "shipments",
        ["tracking_number"],
    )


def downgrade() -> None:
    op.drop_index("ix_shipments_tracking_number", table_name="shipments")
    op.drop_index("ix_order_items_order_id_design_status", table_name="order_items")
    op.drop_index("ix_order_items_design_status", table_name="order_items")
