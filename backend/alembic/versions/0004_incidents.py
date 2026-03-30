"""incidents

Revision ID: 0004_incidents
Revises: 0003_order_production_status
Create Date: 2026-03-28 22:10:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_incidents"
down_revision: Union[str, Sequence[str], None] = "0003_order_production_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


incident_type = sa.Enum(
    "missing_asset",
    "personalization_error",
    "production_blocked",
    "shipping_exception",
    "address_issue",
    "stock_issue",
    name="incident_type",
    native_enum=False,
    create_constraint=True,
)

incident_priority = sa.Enum(
    "low",
    "medium",
    "high",
    "urgent",
    name="incident_priority",
    native_enum=False,
    create_constraint=True,
)

incident_status = sa.Enum(
    "open",
    "in_progress",
    "resolved",
    name="incident_status",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    bind = op.get_bind()
    incident_type.create(bind, checkfirst=True)
    incident_priority.create(bind, checkfirst=True)
    incident_status.create(bind, checkfirst=True)

    op.create_table(
        "incidents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("type", incident_type, nullable=False),
        sa.Column("priority", incident_priority, nullable=False),
        sa.Column("status", incident_status, nullable=False, server_default="open"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assignee", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_incidents_order_id"), "incidents", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_incidents_order_id"), table_name="incidents")
    op.drop_table("incidents")

    bind = op.get_bind()
    incident_status.drop(bind, checkfirst=True)
    incident_priority.drop(bind, checkfirst=True)
    incident_type.drop(bind, checkfirst=True)
