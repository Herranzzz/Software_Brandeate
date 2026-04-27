"""email_flow_logs: partial unique index + retry bookkeeping

Adds a partial unique index over (shop_id, order_id, flow_type) WHERE
status = 'sent' so the database itself guarantees a single successful
send per (order, flow_type). Pre-existing duplicate 'sent' rows are
collapsed to the earliest one before the index is created.

Also introduces `attempts` and `next_attempt_at` columns so the
scheduler can apply exponential backoff and bound retries instead of
reattempting every cycle.

Revision ID: 0045_email_flow_logs_dedupe
Revises: 0044_sga
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0045_email_flow_logs_dedupe"
down_revision = "0044_sga"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_flow_logs",
        sa.Column("attempts", sa.Integer, nullable=False, server_default="1"),
    )
    op.add_column(
        "email_flow_logs",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.execute(
        """
        DELETE FROM email_flow_logs
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY shop_id, order_id, flow_type
                    ORDER BY sent_at, id
                ) AS rn
                FROM email_flow_logs
                WHERE status = 'sent' AND order_id IS NOT NULL
            ) ranked
            WHERE rn > 1
        )
        """
    )

    op.create_index(
        "uq_email_flow_logs_sent_per_order_type",
        "email_flow_logs",
        ["shop_id", "order_id", "flow_type"],
        unique=True,
        postgresql_where=sa.text("status = 'sent' AND order_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_email_flow_logs_sent_per_order_type",
        table_name="email_flow_logs",
    )
    op.drop_column("email_flow_logs", "next_attempt_at")
    op.drop_column("email_flow_logs", "attempts")
