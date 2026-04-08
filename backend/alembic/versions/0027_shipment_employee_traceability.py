"""shipment employee traceability

Revision ID: 0027_employee_traceability
Revises: 0026_returns
Create Date: 2026-04-08 13:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0027_employee_traceability"
down_revision = "0026_returns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("shipments")}
    foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("shipments")}
    indexes = {index["name"] for index in inspector.get_indexes("shipments")}

    if "created_by_employee_id" not in columns:
        op.add_column("shipments", sa.Column("created_by_employee_id", sa.Integer(), nullable=True))

    if "fk_shipments_created_by_employee_id_users" not in foreign_keys:
        op.create_foreign_key(
            "fk_shipments_created_by_employee_id_users",
            "shipments",
            "users",
            ["created_by_employee_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if "ix_shipments_created_by_employee_id" not in indexes:
        op.create_index(
            "ix_shipments_created_by_employee_id",
            "shipments",
            ["created_by_employee_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_shipments_created_by_employee_id", table_name="shipments")
    op.drop_constraint("fk_shipments_created_by_employee_id_users", "shipments", type_="foreignkey")
    op.drop_column("shipments", "created_by_employee_id")
