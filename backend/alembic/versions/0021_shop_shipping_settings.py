"""add shop shipping settings

Revision ID: 0021_shop_shipping_settings
Revises: 0020_order_ship_snapshot
Create Date: 2026-04-02 00:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0021_shop_shipping_settings"
down_revision: Union[str, Sequence[str], None] = "0020_order_ship_snapshot"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shops",
        sa.Column(
            "shipping_settings_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("shops", "shipping_settings_json")
