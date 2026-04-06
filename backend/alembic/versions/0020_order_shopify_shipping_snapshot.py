"""add order shopify shipping snapshot

Revision ID: 0020_order_ship_snapshot
Revises: 0019_shipment_shopify_sync
Create Date: 2026-04-01 23:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0020_order_ship_snapshot"
down_revision: Union[str, Sequence[str], None] = "0019_shipment_shopify_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "shopify_shipping_snapshot_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "shopify_shipping_snapshot_json")
