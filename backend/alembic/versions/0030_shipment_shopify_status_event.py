"""shipment: add shopify_status_event_pushed column

Tracks the last shipping_status that was successfully pushed as a
Shopify fulfillment event, so we don't send duplicate events.

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_shipment_shopify_status_event"
down_revision = "0029_prepared_orders_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shipments",
        sa.Column("shopify_status_event_pushed", sa.String(120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shipments", "shopify_status_event_pushed")
