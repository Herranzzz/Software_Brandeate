"""order_internal_note: add internal_note to orders

Revision ID: 0039_order_internal_note
Revises: 0038_return_inspection_notes
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0039_order_internal_note"
down_revision = "0038_return_inspection_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("internal_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "internal_note")
