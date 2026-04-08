"""shipment employee traceability

Revision ID: 0027_employee_traceability
Revises: 0026_returns
Create Date: 2026-04-08 13:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_employee_traceability"
down_revision = "0026_returns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shipments", sa.Column("created_by_employee_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_shipments_created_by_employee_id_users",
        "shipments",
        "users",
        ["created_by_employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
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
