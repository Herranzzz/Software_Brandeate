"""ctt tracking sync

Revision ID: 0025_ctt_tracking_sync
Revises: 0024_shipping_rules
Create Date: 2026-04-02 16:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_ctt_tracking_sync"
down_revision = "0024_shipping_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracking_events", sa.Column("source", sa.String(length=32), nullable=True))
    op.add_column("tracking_events", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column("tracking_events", sa.Column("payload_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tracking_events", "payload_json")
    op.drop_column("tracking_events", "location")
    op.drop_column("tracking_events", "source")
