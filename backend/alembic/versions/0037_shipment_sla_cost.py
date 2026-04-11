"""shipment_sla_cost: add expected_ship_date, expected_delivery_date, shipping_cost to shipments

Revision ID: 0037_shipment_sla_cost
Revises: 0036_order_block
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_shipment_sla_cost"
down_revision = "0036_order_block"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shipments", sa.Column("expected_ship_date", sa.Date(), nullable=True))
    op.add_column("shipments", sa.Column("expected_delivery_date", sa.Date(), nullable=True))
    op.add_column("shipments", sa.Column("shipping_cost", sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("shipments", "shipping_cost")
    op.drop_column("shipments", "expected_delivery_date")
    op.drop_column("shipments", "expected_ship_date")
