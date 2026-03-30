"""add order item customization provider

Revision ID: 0010_item_provider
Revises: 0009_shopify_state
Create Date: 2026-03-29 12:10:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_item_provider"
down_revision: Union[str, Sequence[str], None] = "0009_shopify_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("customization_provider", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "customization_provider")
