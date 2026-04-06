"""returns table

Revision ID: 0026_returns
Revises: 0025_ctt_tracking_sync
Create Date: 2026-04-02 18:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_returns"
down_revision = "0025_ctt_tracking_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "returns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_email", sa.String(length=255), nullable=True),
        sa.Column("reason", sa.String(length=50), nullable=False, server_default="other"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="requested"),
        sa.Column("tracking_number", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("returns")
