"""email_flow_drafts: shadow-mode storage for LLM-generated drafts

While the email agent runs in shadow mode the LLM output is persisted
here so the team can compare it against the template version that was
actually sent. Once shadow mode is turned off, the same table holds
the canonical body that was rendered+sent.

Revision ID: 0046_email_flow_drafts
Revises: 0045_email_flow_logs_dedupe
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0046_email_flow_drafts"
down_revision = "0045_email_flow_logs_dedupe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_flow_drafts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "shop_id",
            sa.Integer,
            sa.ForeignKey("shops.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "order_id",
            sa.Integer,
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("flow_type", sa.String(32), nullable=False, index=True),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("persona_name", sa.String(120), nullable=True),
        sa.Column("subject", sa.String(512), nullable=False),
        sa.Column("body_text", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column(
            "requires_human_review",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column("template_subject", sa.String(512), nullable=True),
        sa.Column("template_body_text", sa.Text, nullable=True),
        sa.Column(
            "was_sent",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "shadow_mode",
            sa.Boolean,
            nullable=False,
            server_default="true",
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("email_flow_drafts")
