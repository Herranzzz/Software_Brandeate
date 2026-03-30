"""shopify sync and personalization

Revision ID: 0008_shopify_sync
Revises: 0007_users_auth
Create Date: 2026-03-29 02:10:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0008_shopify_sync"
down_revision: Union[str, Sequence[str], None] = "0007_users_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.add_column("shop_integrations", sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shop_integrations", sa.Column("last_sync_status", sa.String(length=50), nullable=True))
    op.add_column("shop_integrations", sa.Column("last_sync_summary", json_type, nullable=True))

    op.add_column("order_items", sa.Column("customization_id", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("design_link", sa.String(length=2048), nullable=True))
    op.add_column("order_items", sa.Column("personalization_details_json", json_type, nullable=True))

    op.create_table(
        "shop_sync_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shipments_created_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("incidents_created_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_shop_sync_events_shop_id"), "shop_sync_events", ["shop_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shop_sync_events_shop_id"), table_name="shop_sync_events")
    op.drop_table("shop_sync_events")

    op.drop_column("order_items", "personalization_details_json")
    op.drop_column("order_items", "design_link")
    op.drop_column("order_items", "customization_id")

    op.drop_column("shop_integrations", "last_sync_summary")
    op.drop_column("shop_integrations", "last_sync_status")
    op.drop_column("shop_integrations", "last_synced_at")
