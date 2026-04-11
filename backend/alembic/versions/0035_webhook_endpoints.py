"""webhook_endpoints: create webhook_endpoints table

Revision ID: 0035_webhook_endpoints
Revises: 0034_shop_tracking_config
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0035_webhook_endpoints"
down_revision = "0034_shop_tracking_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("secret", sa.String(255), nullable=True),
        sa.Column("events", JSONB(), nullable=False, server_default="[]"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status_code", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_webhook_endpoints_shop_id", "webhook_endpoints", ["shop_id"])


def downgrade() -> None:
    op.drop_index("ix_webhook_endpoints_shop_id")
    op.drop_table("webhook_endpoints")
