"""shipments: support replacement shipments per order

Drops the per-order unique constraint and adds replacement metadata so an
operator can issue a second (or third) label for the same order — e.g. when
a parcel is lost, damaged, or the customer needs a redelivery.

Schema changes:
  * shipments.order_id loses its UNIQUE constraint (still indexed).
  * replacement_sequence: 1 for the original, 2+ for replacements. Defaults
    to 1 so existing rows backfill cleanly.
  * replacement_reason: free-text "why" supplied by the operator.
  * replaces_shipment_id: FK to the previous shipment in the chain (audit).
  * is_cost_pending: replacements typically wait for billing, so the cost
    column stays NULL and this flag drives the "Pendiente" UI badge.
  * shopify_fulfillment_cancelled_at: when the prior Shopify fulfillment
    was cancelled in favor of this replacement.

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0033_shipment_replacements"
down_revision = "0032_search_trgm_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the unique constraint on order_id but keep the index for lookup.
    # The constraint name follows SQLAlchemy's default naming convention.
    # If your DB used a different name, adjust here.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for uc in insp.get_unique_constraints("shipments"):
        if uc.get("column_names") == ["order_id"]:
            op.drop_constraint(uc["name"], "shipments", type_="unique")
            break

    op.add_column(
        "shipments",
        sa.Column(
            "replacement_sequence",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "shipments",
        sa.Column("replacement_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "shipments",
        sa.Column("replaces_shipment_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_shipments_replaces_shipment_id",
        "shipments",
        "shipments",
        ["replaces_shipment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_shipments_order_id_sequence",
        "shipments",
        ["order_id", "replacement_sequence"],
    )
    op.add_column(
        "shipments",
        sa.Column(
            "is_cost_pending",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "shipments",
        sa.Column(
            "shopify_fulfillment_cancelled_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("shipments", "shopify_fulfillment_cancelled_at")
    op.drop_column("shipments", "is_cost_pending")
    op.drop_index("ix_shipments_order_id_sequence", table_name="shipments")
    op.drop_constraint("fk_shipments_replaces_shipment_id", "shipments", type_="foreignkey")
    op.drop_column("shipments", "replaces_shipment_id")
    op.drop_column("shipments", "replacement_reason")
    op.drop_column("shipments", "replacement_sequence")
    op.create_unique_constraint("uq_shipments_order_id", "shipments", ["order_id"])
