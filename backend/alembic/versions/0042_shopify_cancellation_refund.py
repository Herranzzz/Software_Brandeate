"""shopify_cancellation_refund: track Shopify cancellations and line-item refunds

Adds:
- orders.cancelled_at (timestamp of Shopify cancellation)
- orders.cancel_reason (Shopify cancel reason code)
- order_items.refunded_quantity (how many units were refunded in Shopify)
- extends the order_status CHECK constraint with a new "cancelled" value

Revision ID: 0042_shopify_cancellation_refund
Revises: 0041_shipment_final_weight
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0042_shopify_cancellation_refund"
down_revision = "0041_shipment_final_weight"
branch_labels = None
depends_on = None


_OLD_STATUSES = ("pending", "in_progress", "ready_to_ship", "shipped", "delivered", "exception")
_NEW_STATUSES = _OLD_STATUSES + ("cancelled",)


def _status_in_clause(statuses: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{s}'" for s in statuses)
    return f"status IN ({joined})"


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_orders_cancelled_at",
        "orders",
        ["cancelled_at"],
    )
    op.add_column(
        "orders",
        sa.Column("cancel_reason", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "order_items",
        sa.Column(
            "refunded_quantity",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # Expand the order_status CHECK constraint to accept "cancelled".
    # SQLAlchemy created the constraint with name="order_status" because
    # the Enum uses native_enum=False + create_constraint=True.
    op.drop_constraint("order_status", "orders", type_="check")
    op.create_check_constraint(
        "order_status",
        "orders",
        _status_in_clause(_NEW_STATUSES),
    )


def downgrade() -> None:
    # Move any "cancelled" rows back to "exception" so the narrower
    # constraint can be recreated without violations.
    op.execute(
        "UPDATE orders SET status = 'exception' WHERE status = 'cancelled'"
    )
    op.drop_constraint("order_status", "orders", type_="check")
    op.create_check_constraint(
        "order_status",
        "orders",
        _status_in_clause(_OLD_STATUSES),
    )

    op.drop_column("order_items", "refunded_quantity")
    op.drop_column("orders", "cancel_reason")
    op.drop_index("ix_orders_cancelled_at", table_name="orders")
    op.drop_column("orders", "cancelled_at")
