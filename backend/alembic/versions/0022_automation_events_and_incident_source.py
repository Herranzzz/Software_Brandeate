"""add automation events and incident source fields

Revision ID: 0022_automation_events
Revises: 0021_shop_shipping_settings
Create Date: 2026-04-02 01:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0022_automation_events"
down_revision: Union[str, Sequence[str], None] = "0021_shop_shipping_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


automation_entity_type = sa.Enum(
    "order",
    "shipment",
    name="automation_entity_type",
    native_enum=False,
    create_constraint=True,
)

automation_action_type = sa.Enum(
    "flag_detected",
    "incident_created",
    "priority_raised",
    name="automation_action_type",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    automation_entity_type.create(op.get_bind(), checkfirst=True)
    automation_action_type.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "incidents",
        sa.Column("is_automated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "incidents",
        sa.Column("automation_rule_name", sa.String(length=120), nullable=True),
    )

    op.create_table(
        "automation_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("shipment_id", sa.Integer(), nullable=True),
        sa.Column("entity_type", automation_entity_type, nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("rule_name", sa.String(length=120), nullable=False),
        sa.Column("action_type", automation_action_type, nullable=False),
        sa.Column("summary", sa.String(length=255), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("fingerprint", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint", name="uq_automation_events_fingerprint"),
    )
    op.create_index(op.f("ix_automation_events_shop_id"), "automation_events", ["shop_id"], unique=False)
    op.create_index(op.f("ix_automation_events_order_id"), "automation_events", ["order_id"], unique=False)
    op.create_index(op.f("ix_automation_events_shipment_id"), "automation_events", ["shipment_id"], unique=False)
    op.create_index(op.f("ix_automation_events_entity_id"), "automation_events", ["entity_id"], unique=False)
    op.create_index(op.f("ix_automation_events_rule_name"), "automation_events", ["rule_name"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_automation_events_rule_name"), table_name="automation_events")
    op.drop_index(op.f("ix_automation_events_entity_id"), table_name="automation_events")
    op.drop_index(op.f("ix_automation_events_shipment_id"), table_name="automation_events")
    op.drop_index(op.f("ix_automation_events_order_id"), table_name="automation_events")
    op.drop_index(op.f("ix_automation_events_shop_id"), table_name="automation_events")
    op.drop_table("automation_events")
    op.drop_column("incidents", "automation_rule_name")
    op.drop_column("incidents", "is_automated")
    automation_action_type.drop(op.get_bind(), checkfirst=True)
    automation_entity_type.drop(op.get_bind(), checkfirst=True)
