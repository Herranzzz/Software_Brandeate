"""add order item design status

Revision ID: 0011_item_design
Revises: 0010_item_provider
Create Date: 2026-03-29 14:05:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011_item_design"
down_revision: Union[str, Sequence[str], None] = "0010_item_provider"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column(
            "design_status",
            sa.Enum(
                "design_available",
                "pending_asset",
                "missing_asset",
                name="design_status",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("order_items", "design_status")
