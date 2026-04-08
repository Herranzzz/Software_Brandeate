"""employee activity audit

Revision ID: 0028_employee_activity
Revises: 0027_employee_traceability
Create Date: 2026-04-08 18:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0028_employee_activity"
down_revision = "0027_employee_traceability"
branch_labels = None
depends_on = None


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _foreign_key_names(inspector, table_name: str) -> set[str]:
    return {foreign_key["name"] for foreign_key in inspector.get_foreign_keys(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    order_columns = _column_names(inspector, "orders")
    order_foreign_keys = _foreign_key_names(inspector, "orders")
    order_indexes = _index_names(inspector, "orders")

    if "prepared_by_employee_id" not in order_columns:
        op.add_column("orders", sa.Column("prepared_by_employee_id", sa.Integer(), nullable=True))
    if "prepared_at" not in order_columns:
        op.add_column("orders", sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True))
    if "last_touched_by_employee_id" not in order_columns:
        op.add_column("orders", sa.Column("last_touched_by_employee_id", sa.Integer(), nullable=True))
    if "last_touched_at" not in order_columns:
        op.add_column("orders", sa.Column("last_touched_at", sa.DateTime(timezone=True), nullable=True))

    if "fk_orders_prepared_by_employee_id_users" not in order_foreign_keys:
        op.create_foreign_key(
            "fk_orders_prepared_by_employee_id_users",
            "orders",
            "users",
            ["prepared_by_employee_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "fk_orders_last_touched_by_employee_id_users" not in order_foreign_keys:
        op.create_foreign_key(
            "fk_orders_last_touched_by_employee_id_users",
            "orders",
            "users",
            ["last_touched_by_employee_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if "ix_orders_prepared_by_employee_id" not in order_indexes:
        op.create_index("ix_orders_prepared_by_employee_id", "orders", ["prepared_by_employee_id"], unique=False)
    if "ix_orders_prepared_at" not in order_indexes:
        op.create_index("ix_orders_prepared_at", "orders", ["prepared_at"], unique=False)
    if "ix_orders_last_touched_by_employee_id" not in order_indexes:
        op.create_index("ix_orders_last_touched_by_employee_id", "orders", ["last_touched_by_employee_id"], unique=False)
    if "ix_orders_last_touched_at" not in order_indexes:
        op.create_index("ix_orders_last_touched_at", "orders", ["last_touched_at"], unique=False)

    incident_columns = _column_names(inspector, "incidents")
    incident_foreign_keys = _foreign_key_names(inspector, "incidents")
    incident_indexes = _index_names(inspector, "incidents")

    if "last_touched_by_employee_id" not in incident_columns:
        op.add_column("incidents", sa.Column("last_touched_by_employee_id", sa.Integer(), nullable=True))
    if "last_touched_at" not in incident_columns:
        op.add_column("incidents", sa.Column("last_touched_at", sa.DateTime(timezone=True), nullable=True))

    if "fk_incidents_last_touched_by_employee_id_users" not in incident_foreign_keys:
        op.create_foreign_key(
            "fk_incidents_last_touched_by_employee_id_users",
            "incidents",
            "users",
            ["last_touched_by_employee_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if "ix_incidents_last_touched_by_employee_id" not in incident_indexes:
        op.create_index(
            "ix_incidents_last_touched_by_employee_id",
            "incidents",
            ["last_touched_by_employee_id"],
            unique=False,
        )
    if "ix_incidents_last_touched_at" not in incident_indexes:
        op.create_index("ix_incidents_last_touched_at", "incidents", ["last_touched_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_incidents_last_touched_at", table_name="incidents")
    op.drop_index("ix_incidents_last_touched_by_employee_id", table_name="incidents")
    op.drop_constraint("fk_incidents_last_touched_by_employee_id_users", "incidents", type_="foreignkey")
    op.drop_column("incidents", "last_touched_at")
    op.drop_column("incidents", "last_touched_by_employee_id")

    op.drop_index("ix_orders_last_touched_at", table_name="orders")
    op.drop_index("ix_orders_last_touched_by_employee_id", table_name="orders")
    op.drop_index("ix_orders_prepared_at", table_name="orders")
    op.drop_index("ix_orders_prepared_by_employee_id", table_name="orders")
    op.drop_constraint("fk_orders_last_touched_by_employee_id_users", "orders", type_="foreignkey")
    op.drop_constraint("fk_orders_prepared_by_employee_id_users", "orders", type_="foreignkey")
    op.drop_column("orders", "last_touched_at")
    op.drop_column("orders", "last_touched_by_employee_id")
    op.drop_column("orders", "prepared_at")
    op.drop_column("orders", "prepared_by_employee_id")
