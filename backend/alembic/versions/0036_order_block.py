"""order_block: add is_blocked and block_reason to orders

Revision ID: 0036_order_block
Revises: 0035_webhook_endpoints
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0036_order_block"
down_revision = "0035_webhook_endpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "orders",
        sa.Column("block_reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_orders_is_blocked", "orders", ["is_blocked"])


def downgrade() -> None:
    op.drop_index("ix_orders_is_blocked", table_name="orders")
    op.drop_column("orders", "block_reason")
    op.drop_column("orders", "is_blocked")
