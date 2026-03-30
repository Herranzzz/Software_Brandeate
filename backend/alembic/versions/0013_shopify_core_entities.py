"""shopify core entities and enriched sync fields

Revision ID: 0013_shopify_core_entities
Revises: 0012_shop_catalog_products
Create Date: 2026-03-29 04:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0013_shopify_core_entities"
down_revision: Union[str, Sequence[str], None] = "0012_shop_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.create_table(
        "shop_customers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_customer_id", sa.String(length=255), nullable=False),
        sa.Column("first_name", sa.String(length=120), nullable=True),
        sa.Column("last_name", sa.String(length=120), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=60), nullable=True),
        sa.Column("tags_json", json_type, nullable=True),
        sa.Column("default_address_json", json_type, nullable=True),
        sa.Column("total_orders", sa.Integer(), nullable=True),
        sa.Column("last_order_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "provider", "external_customer_id", name="uq_shop_customers_shop_provider_external"),
    )
    op.create_index(op.f("ix_shop_customers_provider"), "shop_customers", ["provider"], unique=False)
    op.create_index(op.f("ix_shop_customers_external_customer_id"), "shop_customers", ["external_customer_id"], unique=False)
    op.create_index(op.f("ix_shop_customers_shop_id"), "shop_customers", ["shop_id"], unique=False)

    op.add_column("orders", sa.Column("shopify_order_gid", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shopify_order_name", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("customer_external_id", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("tags_json", json_type, nullable=True))
    op.add_column("orders", sa.Column("channel", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("shopify_financial_status", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("shopify_fulfillment_status", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("fulfillment_orders_json", json_type, nullable=True))
    op.create_index(op.f("ix_orders_shopify_order_gid"), "orders", ["shopify_order_gid"], unique=False)
    op.create_index(op.f("ix_orders_customer_external_id"), "orders", ["customer_external_id"], unique=False)

    op.add_column("order_items", sa.Column("shopify_line_item_gid", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("product_id", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("variant_id", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("title", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("variant_title", sa.String(length=255), nullable=True))
    op.add_column("order_items", sa.Column("properties_json", json_type, nullable=True))
    op.create_index(op.f("ix_order_items_shopify_line_item_gid"), "order_items", ["shopify_line_item_gid"], unique=False)
    op.create_index(op.f("ix_order_items_product_id"), "order_items", ["product_id"], unique=False)
    op.create_index(op.f("ix_order_items_variant_id"), "order_items", ["variant_id"], unique=False)

    op.add_column("shipments", sa.Column("fulfillment_id", sa.String(length=255), nullable=True))
    op.add_column("shipments", sa.Column("tracking_url", sa.String(length=2048), nullable=True))
    op.add_column("shipments", sa.Column("shipping_status", sa.String(length=120), nullable=True))
    op.add_column("shipments", sa.Column("shipping_status_detail", sa.Text(), nullable=True))
    op.create_index(op.f("ix_shipments_fulfillment_id"), "shipments", ["fulfillment_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shipments_fulfillment_id"), table_name="shipments")
    op.drop_column("shipments", "shipping_status_detail")
    op.drop_column("shipments", "shipping_status")
    op.drop_column("shipments", "tracking_url")
    op.drop_column("shipments", "fulfillment_id")

    op.drop_index(op.f("ix_order_items_variant_id"), table_name="order_items")
    op.drop_index(op.f("ix_order_items_product_id"), table_name="order_items")
    op.drop_index(op.f("ix_order_items_shopify_line_item_gid"), table_name="order_items")
    op.drop_column("order_items", "properties_json")
    op.drop_column("order_items", "variant_title")
    op.drop_column("order_items", "title")
    op.drop_column("order_items", "variant_id")
    op.drop_column("order_items", "product_id")
    op.drop_column("order_items", "shopify_line_item_gid")

    op.drop_index(op.f("ix_orders_customer_external_id"), table_name="orders")
    op.drop_index(op.f("ix_orders_shopify_order_gid"), table_name="orders")
    op.drop_column("orders", "fulfillment_orders_json")
    op.drop_column("orders", "shopify_fulfillment_status")
    op.drop_column("orders", "shopify_financial_status")
    op.drop_column("orders", "channel")
    op.drop_column("orders", "tags_json")
    op.drop_column("orders", "note")
    op.drop_column("orders", "customer_external_id")
    op.drop_column("orders", "shopify_order_name")
    op.drop_column("orders", "shopify_order_gid")

    op.drop_index(op.f("ix_shop_customers_shop_id"), table_name="shop_customers")
    op.drop_index(op.f("ix_shop_customers_external_customer_id"), table_name="shop_customers")
    op.drop_index(op.f("ix_shop_customers_provider"), table_name="shop_customers")
    op.drop_table("shop_customers")
