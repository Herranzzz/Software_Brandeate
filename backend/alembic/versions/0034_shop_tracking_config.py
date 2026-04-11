"""shop: add tracking_config_json column

Revision ID: 0034_shop_tracking_config
Revises: 0033_activity_log
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0034_shop_tracking_config"
down_revision = "0033_activity_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shops", sa.Column("tracking_config_json", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("shops", "tracking_config_json")
