"""order production status

Revision ID: 0003_order_production_status
Revises: 0002_mvp_entities
Create Date: 2026-03-28 20:45:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_order_production_status"
down_revision: Union[str, Sequence[str], None] = "0002_mvp_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


production_status = sa.Enum(
    "pending_personalization",
    "in_production",
    "packed",
    "completed",
    name="production_status",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    production_status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "orders",
        sa.Column(
            "production_status",
            production_status,
            nullable=False,
            server_default="pending_personalization",
        ),
    )
    op.alter_column("orders", "production_status", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "production_status")
    production_status.drop(op.get_bind(), checkfirst=True)
