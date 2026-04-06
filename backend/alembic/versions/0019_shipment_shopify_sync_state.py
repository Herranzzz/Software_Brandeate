"""add shipment shopify sync state

Revision ID: 0019_shipment_shopify_sync
Revises: 0018_order_ship_meta
Create Date: 2026-04-01 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0019_shipment_shopify_sync"
down_revision: Union[str, Sequence[str], None] = "0018_order_ship_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("shipments", sa.Column("shopify_sync_status", sa.String(length=32), nullable=True))
    op.add_column("shipments", sa.Column("shopify_sync_error", sa.Text(), nullable=True))
    op.add_column("shipments", sa.Column("shopify_last_sync_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shipments", sa.Column("shopify_synced_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("shipments", "shopify_synced_at")
    op.drop_column("shipments", "shopify_last_sync_attempt_at")
    op.drop_column("shipments", "shopify_sync_error")
    op.drop_column("shipments", "shopify_sync_status")
