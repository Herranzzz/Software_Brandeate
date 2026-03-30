"""shop integrations

Revision ID: 0005_shop_integrations
Revises: 0004_incidents
Create Date: 2026-03-28 23:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_shop_integrations"
down_revision: Union[str, Sequence[str], None] = "0004_incidents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shop_integrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("shop_domain", sa.String(length=255), nullable=False),
        sa.Column("access_token", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("shop_id", "provider", "shop_domain", name="uq_shop_integrations_unique"),
    )
    op.create_index(op.f("ix_shop_integrations_provider"), "shop_integrations", ["provider"], unique=False)
    op.create_index(op.f("ix_shop_integrations_shop_id"), "shop_integrations", ["shop_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shop_integrations_shop_id"), table_name="shop_integrations")
    op.drop_index(op.f("ix_shop_integrations_provider"), table_name="shop_integrations")
    op.drop_table("shop_integrations")
