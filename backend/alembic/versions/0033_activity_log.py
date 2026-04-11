"""activity_log: create activity_logs table

Revision ID: 0033_activity_log
Revises: 0032_invoices
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0033_activity_log"
down_revision = "0032_invoices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("actor_name", sa.String(255), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("detail_json", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_activity_logs_entity_timeline",
        "activity_logs",
        ["entity_type", "entity_id", sa.text("created_at DESC")],
    )
    op.create_index("ix_activity_logs_shop_id", "activity_logs", ["shop_id"])


def downgrade() -> None:
    op.drop_index("ix_activity_logs_shop_id")
    op.drop_index("ix_activity_logs_entity_timeline")
    op.drop_table("activity_logs")
