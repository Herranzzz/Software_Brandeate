"""shopify sync state

Revision ID: 0009_shopify_state
Revises: 0008_shopify_sync
Create Date: 2026-03-29 03:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_shopify_state"
down_revision: Union[str, Sequence[str], None] = "0008_shopify_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("shop_integrations", sa.Column("last_error_message", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("shop_integrations", "last_error_message")
