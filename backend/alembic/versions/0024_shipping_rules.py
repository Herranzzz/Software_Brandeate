"""shipping rules

Revision ID: 0024_shipping_rules
Revises: 0023_shipping_options_foundation
Create Date: 2026-04-02 12:50:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_shipping_rules"
down_revision = "0023_shipping_options_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shipping_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("zone_name", sa.String(length=120), nullable=False),
        sa.Column("shipping_rate_name", sa.String(length=255), nullable=True),
        sa.Column("shipping_rate_amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("rule_type", sa.String(length=32), nullable=False),
        sa.Column("min_value", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("max_value", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("carrier_service_code", sa.String(length=64), nullable=False),
        sa.Column("carrier_service_label", sa.String(length=120), nullable=True),
        sa.Column("country_codes_json", sa.JSON(), nullable=True),
        sa.Column("province_codes_json", sa.JSON(), nullable=True),
        sa.Column("postal_code_patterns_json", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shipping_rules_shop_id"), "shipping_rules", ["shop_id"], unique=False)

    op.add_column("orders", sa.Column("shopify_shipping_rate_name", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shopify_shipping_rate_amount", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("shopify_shipping_rate_currency", sa.String(length=8), nullable=True))

    op.add_column("shipments", sa.Column("shipping_rule_id", sa.Integer(), nullable=True))
    op.add_column("shipments", sa.Column("shipping_rule_name", sa.String(length=120), nullable=True))
    op.add_column("shipments", sa.Column("detected_zone", sa.String(length=120), nullable=True))
    op.add_column("shipments", sa.Column("resolution_mode", sa.String(length=32), nullable=True))
    op.create_foreign_key(
        "fk_shipments_shipping_rule",
        "shipments",
        "shipping_rules",
        ["shipping_rule_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_shipments_shipping_rule", "shipments", type_="foreignkey")
    op.drop_column("shipments", "resolution_mode")
    op.drop_column("shipments", "detected_zone")
    op.drop_column("shipments", "shipping_rule_name")
    op.drop_column("shipments", "shipping_rule_id")

    op.drop_column("orders", "shopify_shipping_rate_currency")
    op.drop_column("orders", "shopify_shipping_rate_amount")
    op.drop_column("orders", "shopify_shipping_rate_name")

    op.drop_index(op.f("ix_shipping_rules_shop_id"), table_name="shipping_rules")
    op.drop_table("shipping_rules")
