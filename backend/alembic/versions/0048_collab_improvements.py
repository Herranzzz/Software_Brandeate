"""collab: comment edit/delete + order assignment

Revision ID: 0048
Revises: 0047
Create Date: 2026-04-28
"""

from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── activity_logs: soft-delete + edit tracking ──────────────────────────
    op.add_column(
        "activity_logs",
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "activity_logs",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # ── orders: assignment tracking ─────────────────────────────────────────
    op.add_column(
        "orders",
        sa.Column("assigned_to_employee_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("assigned_by_employee_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_orders_assigned_to_employee",
        "orders",
        "users",
        ["assigned_to_employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_orders_assigned_by_employee",
        "orders",
        "users",
        ["assigned_by_employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_orders_assigned_to_employee_id",
        "orders",
        ["assigned_to_employee_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_orders_assigned_to_employee_id", table_name="orders")
    op.drop_constraint("fk_orders_assigned_by_employee", "orders", type_="foreignkey")
    op.drop_constraint("fk_orders_assigned_to_employee", "orders", type_="foreignkey")
    op.drop_column("orders", "assigned_by_employee_id")
    op.drop_column("orders", "assigned_at")
    op.drop_column("orders", "assigned_to_employee_id")
    op.drop_column("activity_logs", "is_deleted")
    op.drop_column("activity_logs", "edited_at")
