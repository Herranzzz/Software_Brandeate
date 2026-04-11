"""invoices: create invoices and invoice_items tables

Revision ID: 0032_invoices
Revises: 0031_inventory_sga
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision = "0032_invoices"
down_revision = "0031_inventory_sga"
branch_labels = None
depends_on = None

# Use PGEnum with create_type=False so SQLAlchemy never auto-emits
# CREATE TYPE. We handle type creation ourselves via a DO block that
# is safe to run even when the type already exists.
_invoice_status = PGEnum(
    "draft", "sent", "paid", "cancelled",
    name="invoice_status",
    create_type=False,
)


def upgrade() -> None:
    # Create the enum type idempotently — safe on both fresh DBs and
    # DBs where a previous partial migration already created the type.
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'cancelled');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.create_table(
        "invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(64), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("status", _invoice_status, server_default="draft", nullable=False),
        sa.Column("client_name", sa.String(255), nullable=False),
        sa.Column("client_email", sa.String(320), nullable=False),
        sa.Column("client_company", sa.String(255), nullable=True),
        sa.Column("client_tax_id", sa.String(64), nullable=True),
        sa.Column("client_address", sa.Text(), nullable=True),
        sa.Column("sender_name", sa.String(255), nullable=True),
        sa.Column("sender_tax_id", sa.String(64), nullable=True),
        sa.Column("sender_address", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(8), server_default="EUR", nullable=False),
        sa.Column("tax_rate", sa.Numeric(5, 2), server_default="21.00", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("payment_terms", sa.String(120), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_number"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_invoices_invoice_number", "invoices", ["invoice_number"])
    op.create_index("ix_invoices_shop_id", "invoices", ["shop_id"])

    op.create_table(
        "invoice_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), server_default="1.000", nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_invoice_items_invoice_id", "invoice_items", ["invoice_id"])


def downgrade() -> None:
    op.drop_table("invoice_items")
    op.drop_table("invoices")
    op.execute("""
        DO $$ BEGIN
            DROP TYPE invoice_status;
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;
    """)
