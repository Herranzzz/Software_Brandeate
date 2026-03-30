"""order is personalized

Revision ID: 0006_order_is_personalized
Revises: 0005_shop_integrations
Create Date: 2026-03-28 23:55:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_order_is_personalized"
down_revision: Union[str, Sequence[str], None] = "0005_shop_integrations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("is_personalized", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        UPDATE orders
        SET is_personalized = true
        WHERE EXISTS (
            SELECT 1
            FROM order_items
            WHERE order_items.order_id = orders.id
              AND (
                order_items.personalization_notes IS NOT NULL
                OR order_items.personalization_assets_json IS NOT NULL
              )
        )
        """
    )
    op.alter_column("orders", "is_personalized", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "is_personalized")
