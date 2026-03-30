"""add pick batches

Revision ID: 0016_pick_batches
Revises: 0015_order_priority
Create Date: 2026-03-29 09:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016_pick_batches"
down_revision: Union[str, Sequence[str], None] = "0015_order_priority"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


pick_batch_status_enum = sa.Enum(
    "draft",
    "active",
    "completed",
    name="pick_batch_status",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    pick_batch_status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "pick_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("status", pick_batch_status_enum, nullable=False, server_default="draft"),
        sa.Column("orders_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pick_batches_shop_id"), "pick_batches", ["shop_id"], unique=False)
    op.create_index(op.f("ix_pick_batches_status"), "pick_batches", ["status"], unique=False)

    op.create_table(
        "pick_batch_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["pick_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "order_id", name="uq_pick_batch_orders_batch_order"),
    )
    op.create_index(op.f("ix_pick_batch_orders_batch_id"), "pick_batch_orders", ["batch_id"], unique=False)
    op.create_index(op.f("ix_pick_batch_orders_order_id"), "pick_batch_orders", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_pick_batch_orders_order_id"), table_name="pick_batch_orders")
    op.drop_index(op.f("ix_pick_batch_orders_batch_id"), table_name="pick_batch_orders")
    op.drop_table("pick_batch_orders")
    op.drop_index(op.f("ix_pick_batches_status"), table_name="pick_batches")
    op.drop_index(op.f("ix_pick_batches_shop_id"), table_name="pick_batches")
    op.drop_table("pick_batches")
    pick_batch_status_enum.drop(op.get_bind(), checkfirst=True)
