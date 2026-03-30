"""add shop catalog products

Revision ID: 0012_shop_catalog
Revises: 0011_item_design
Create Date: 2026-03-29 15:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012_shop_catalog"
down_revision: Union[str, Sequence[str], None] = "0011_item_design"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shop_catalog_products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_product_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("handle", sa.String(length=255), nullable=True),
        sa.Column("vendor", sa.String(length=255), nullable=True),
        sa.Column("product_type", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("image_url", sa.String(length=1000), nullable=True),
        sa.Column("variants_json", sa.JSON(), nullable=True),
        sa.Column("is_personalizable", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "external_product_id", name="uq_shop_catalog_products_shop_external"),
    )
    op.create_index(op.f("ix_shop_catalog_products_shop_id"), "shop_catalog_products", ["shop_id"], unique=False)
    op.create_index(op.f("ix_shop_catalog_products_provider"), "shop_catalog_products", ["provider"], unique=False)
    op.create_index(
        op.f("ix_shop_catalog_products_external_product_id"),
        "shop_catalog_products",
        ["external_product_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_shop_catalog_products_external_product_id"), table_name="shop_catalog_products")
    op.drop_index(op.f("ix_shop_catalog_products_provider"), table_name="shop_catalog_products")
    op.drop_index(op.f("ix_shop_catalog_products_shop_id"), table_name="shop_catalog_products")
    op.drop_table("shop_catalog_products")
