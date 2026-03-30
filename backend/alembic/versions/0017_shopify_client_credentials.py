"""add shopify client credentials

Revision ID: 0017_shopify_client_credentials
Revises: 0016_pick_batches
Create Date: 2026-03-30 16:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017_shopify_client_credentials"
down_revision: Union[str, Sequence[str], None] = "0016_pick_batches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("shop_integrations", sa.Column("client_id", sa.String(length=255), nullable=True))
    op.add_column("shop_integrations", sa.Column("client_secret", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("shop_integrations", "client_secret")
    op.drop_column("shop_integrations", "client_id")
