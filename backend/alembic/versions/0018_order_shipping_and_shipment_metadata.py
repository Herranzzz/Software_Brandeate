"""add order shipping fields and shipment metadata

Revision ID: 0018_order_ship_meta
Revises: 0017_shopify_client_credentials
Create Date: 2026-04-01 16:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0018_order_ship_meta"
down_revision: Union[str, Sequence[str], None] = "0017_shopify_client_credentials"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("shipping_name", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_phone", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("shipping_country_code", sa.String(length=8), nullable=True))
    op.add_column("orders", sa.Column("shipping_postal_code", sa.String(length=32), nullable=True))
    op.add_column("orders", sa.Column("shipping_address_line1", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_address_line2", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_town", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("shipping_province_code", sa.String(length=32), nullable=True))

    op.add_column("shipments", sa.Column("provider_reference", sa.String(length=255), nullable=True))
    op.add_column("shipments", sa.Column("shipping_type_code", sa.String(length=32), nullable=True))
    op.add_column("shipments", sa.Column("weight_tier_code", sa.String(length=64), nullable=True))
    op.add_column("shipments", sa.Column("weight_tier_label", sa.String(length=120), nullable=True))
    op.add_column("shipments", sa.Column("shipping_weight_declared", sa.Float(), nullable=True))
    op.add_column("shipments", sa.Column("package_count", sa.Integer(), nullable=True))
    op.add_column(
        "shipments",
        sa.Column("provider_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("shipments", sa.Column("label_created_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("shipments", "label_created_at")
    op.drop_column("shipments", "provider_payload_json")
    op.drop_column("shipments", "package_count")
    op.drop_column("shipments", "shipping_weight_declared")
    op.drop_column("shipments", "weight_tier_label")
    op.drop_column("shipments", "weight_tier_code")
    op.drop_column("shipments", "shipping_type_code")
    op.drop_column("shipments", "provider_reference")

    op.drop_column("orders", "shipping_province_code")
    op.drop_column("orders", "shipping_town")
    op.drop_column("orders", "shipping_address_line2")
    op.drop_column("orders", "shipping_address_line1")
    op.drop_column("orders", "shipping_postal_code")
    op.drop_column("orders", "shipping_country_code")
    op.drop_column("orders", "shipping_phone")
    op.drop_column("orders", "shipping_name")
