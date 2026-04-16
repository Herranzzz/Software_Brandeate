"""marketing_email_flows: shop marketing_config_json + email_flows + email_flow_logs tables

Revision ID: 0043_marketing_email_flows
Revises: 0042_shopify_cancellation_refund
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0043_marketing_email_flows"
down_revision = "0042_shopify_cancellation_refund"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── shops: add marketing_config_json ─────────────────────────────────────
    op.add_column(
        "shops",
        sa.Column("marketing_config_json", JSONB, nullable=True),
    )

    # ── email_flows ───────────────────────────────────────────────────────────
    op.create_table(
        "email_flows",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("shop_id", sa.Integer, sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("flow_type", sa.String(32), nullable=False, index=True),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("delay_minutes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column("from_email", sa.String(320), nullable=True),
        sa.Column("reply_to", sa.String(320), nullable=True),
        sa.Column("subject_template", sa.String(512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_email_flows_shop_type", "email_flows", ["shop_id", "flow_type"]
    )

    # ── email_flow_logs ───────────────────────────────────────────────────────
    op.create_table(
        "email_flow_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("shop_id", sa.Integer, sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("flow_id", sa.Integer, sa.ForeignKey("email_flows.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("flow_type", sa.String(32), nullable=False, index=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("to_email", sa.String(320), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="sent", index=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("email_flow_logs")
    op.drop_constraint("uq_email_flows_shop_type", "email_flows", type_="unique")
    op.drop_table("email_flows")
    op.drop_column("shops", "marketing_config_json")
