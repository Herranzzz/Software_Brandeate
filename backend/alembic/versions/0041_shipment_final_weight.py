"""shipment_final_weight: add final_weight column to shipments

Revision ID: 0041_shipment_final_weight
Revises: 0040_carrier_configs
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0041_shipment_final_weight"
down_revision = "0040_carrier_configs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shipments", sa.Column("final_weight", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("shipments", "final_weight")
