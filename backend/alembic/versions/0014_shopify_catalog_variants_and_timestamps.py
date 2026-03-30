"""shopify catalog variants and external timestamps

Revision ID: 0014_shopify_catalog_variants
Revises: 0013_shopify_core_entities
Create Date: 2026-03-29 04:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0014_shopify_catalog_variants"
down_revision: Union[str, Sequence[str], None] = "0013_shopify_core_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.add_column("shop_catalog_products", sa.Column("external_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shop_catalog_products", sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("shop_customers", sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "shop_catalog_variants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_product_id", sa.String(length=255), nullable=False),
        sa.Column("external_variant_id", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("option_values_json", json_type, nullable=True),
        sa.Column("external_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["shop_catalog_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "external_variant_id", name="uq_shop_catalog_variants_shop_external"),
    )
    op.create_index(op.f("ix_shop_catalog_variants_shop_id"), "shop_catalog_variants", ["shop_id"], unique=False)
    op.create_index(op.f("ix_shop_catalog_variants_product_id"), "shop_catalog_variants", ["product_id"], unique=False)
    op.create_index(op.f("ix_shop_catalog_variants_provider"), "shop_catalog_variants", ["provider"], unique=False)
    op.create_index(op.f("ix_shop_catalog_variants_external_product_id"), "shop_catalog_variants", ["external_product_id"], unique=False)
    op.create_index(op.f("ix_shop_catalog_variants_external_variant_id"), "shop_catalog_variants", ["external_variant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shop_catalog_variants_external_variant_id"), table_name="shop_catalog_variants")
    op.drop_index(op.f("ix_shop_catalog_variants_external_product_id"), table_name="shop_catalog_variants")
    op.drop_index(op.f("ix_shop_catalog_variants_provider"), table_name="shop_catalog_variants")
    op.drop_index(op.f("ix_shop_catalog_variants_product_id"), table_name="shop_catalog_variants")
    op.drop_index(op.f("ix_shop_catalog_variants_shop_id"), table_name="shop_catalog_variants")
    op.drop_table("shop_catalog_variants")

    op.drop_column("shop_customers", "external_updated_at")

    op.drop_column("shop_catalog_products", "external_updated_at")
    op.drop_column("shop_catalog_products", "external_created_at")
