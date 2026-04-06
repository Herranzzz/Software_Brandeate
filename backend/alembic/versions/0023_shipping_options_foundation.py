"""shipping options foundation

Revision ID: 0023_shipping_options_foundation
Revises: 0022_automation_events
Create Date: 2026-04-02 12:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0023_shipping_options_foundation"
down_revision = "0022_automation_events"
branch_labels = None
depends_on = None


shipping_quote_source_enum = sa.Enum(
    "mock",
    "ctt",
    "custom",
    name="shipping_quote_source",
    native_enum=False,
    create_constraint=True,
)

order_delivery_type_enum = sa.Enum(
    "home",
    "pickup_point",
    name="order_delivery_type",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    shipping_quote_source_enum.create(op.get_bind(), checkfirst=True)
    order_delivery_type_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "shipping_rate_quotes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("carrier", sa.String(length=64), nullable=False),
        sa.Column("service_code", sa.String(length=64), nullable=False),
        sa.Column("service_name", sa.String(length=120), nullable=False),
        sa.Column("delivery_type", sa.String(length=32), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("estimated_days_min", sa.Integer(), nullable=True),
        sa.Column("estimated_days_max", sa.Integer(), nullable=True),
        sa.Column("weight_tier_code", sa.String(length=64), nullable=True),
        sa.Column("destination_country_code", sa.String(length=8), nullable=False),
        sa.Column("destination_postal_code", sa.String(length=32), nullable=False),
        sa.Column("destination_city", sa.String(length=120), nullable=True),
        sa.Column("is_personalized", sa.Boolean(), nullable=True),
        sa.Column("source", shipping_quote_source_enum, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shipping_rate_quotes_shop_id"), "shipping_rate_quotes", ["shop_id"], unique=False)

    op.add_column("orders", sa.Column("delivery_type", order_delivery_type_enum, nullable=True))
    op.add_column("orders", sa.Column("shipping_service_code", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("shipping_service_name", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("shipping_rate_amount", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("shipping_rate_currency", sa.String(length=8), nullable=True))
    op.add_column("orders", sa.Column("shipping_rate_estimated_days_min", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("shipping_rate_estimated_days_max", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("shipping_rate_quote_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("pickup_point_json", sa.JSON(), nullable=True))
    op.add_column("orders", sa.Column("shipping_option_selected_at", sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        "fk_orders_shipping_rate_quote",
        "orders",
        "shipping_rate_quotes",
        ["shipping_rate_quote_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_shipping_rate_quote", "orders", type_="foreignkey")
    op.drop_column("orders", "shipping_option_selected_at")
    op.drop_column("orders", "pickup_point_json")
    op.drop_column("orders", "shipping_rate_quote_id")
    op.drop_column("orders", "shipping_rate_estimated_days_max")
    op.drop_column("orders", "shipping_rate_estimated_days_min")
    op.drop_column("orders", "shipping_rate_currency")
    op.drop_column("orders", "shipping_rate_amount")
    op.drop_column("orders", "shipping_service_name")
    op.drop_column("orders", "shipping_service_code")
    op.drop_column("orders", "delivery_type")

    op.drop_index(op.f("ix_shipping_rate_quotes_shop_id"), table_name="shipping_rate_quotes")
    op.drop_table("shipping_rate_quotes")
    order_delivery_type_enum.drop(op.get_bind(), checkfirst=True)
    shipping_quote_source_enum.drop(op.get_bind(), checkfirst=True)
