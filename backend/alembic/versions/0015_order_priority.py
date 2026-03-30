"""add order priority

Revision ID: 0015_order_priority
Revises: 0014_shopify_catalog_variants
Create Date: 2026-03-29 06:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0015_order_priority"
down_revision: Union[str, Sequence[str], None] = "0014_shopify_catalog_variants"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


order_priority_enum = sa.Enum(
    "low",
    "normal",
    "high",
    "urgent",
    name="order_priority",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    order_priority_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "orders",
        sa.Column(
            "priority",
            order_priority_enum,
            nullable=False,
            server_default="normal",
        ),
    )
    op.create_index(op.f("ix_orders_priority"), "orders", ["priority"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_orders_priority"), table_name="orders")
    op.drop_column("orders", "priority")
    order_priority_enum.drop(op.get_bind(), checkfirst=True)
