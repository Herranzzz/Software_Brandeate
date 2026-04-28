"""catchup: add branch-B columns that were skipped by the stamp recovery

When safe_migrate stamps alembic_version to 0047_merge_heads and then
runs upgrade head, Alembic considers the two parent branches already
applied (because 0047 is the merge point). That means 0031_perf_indexes,
0032_search_trgm_indexes, and 0033_shipment_replacements are NOT actually
executed even though they hadn't run on the Render DB.

This migration adds every column and index from those three migrations
idempotently (IF NOT EXISTS / pre-existence checks) so a re-run is safe.

Revision ID: 0049
Revises: 0048
Create Date: 2026-04-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def _column_exists(bind, table: str, col: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    return col in {c["name"] for c in sa_inspect(bind).get_columns(table)}


def _index_exists(bind, table: str, idx: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    return idx in {i["name"] for i in sa_inspect(bind).get_indexes(table)}


def _fk_exists(bind, table: str, name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    return name in {fk["name"] for fk in sa_inspect(bind).get_foreign_keys(table)}


def _unique_exists(bind, table: str, cols: list[str]) -> bool:
    from sqlalchemy import inspect as sa_inspect
    for uc in sa_inspect(bind).get_unique_constraints(table):
        if uc.get("column_names") == cols:
            return True
    return False


def upgrade() -> None:
    bind = op.get_bind()

    # ── 0031_perf_indexes ────────────────────────────────────────────────────
    if not _index_exists(bind, "order_items", "ix_order_items_design_status"):
        op.create_index("ix_order_items_design_status", "order_items", ["design_status"])

    if not _index_exists(bind, "order_items", "ix_order_items_order_id_design_status"):
        op.create_index(
            "ix_order_items_order_id_design_status",
            "order_items",
            ["order_id", "design_status"],
        )

    if not _index_exists(bind, "shipments", "ix_shipments_tracking_number"):
        op.create_index("ix_shipments_tracking_number", "shipments", ["tracking_number"])

    # ── 0032_search_trgm_indexes (GIN) ──────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    trgm_indexes = [
        ("ix_orders_external_id_trgm",          "orders",    "external_id"),
        ("ix_orders_shopify_order_name_trgm",    "orders",    "shopify_order_name"),
        ("ix_orders_customer_name_trgm",         "orders",    "customer_name"),
        ("ix_orders_customer_email_trgm",        "orders",    "customer_email"),
        ("ix_orders_shipping_phone_trgm",        "orders",    "shipping_phone"),
        ("ix_order_items_sku_trgm",              "order_items", "sku"),
        ("ix_order_items_name_trgm",             "order_items", "name"),
        ("ix_order_items_title_trgm",            "order_items", "title"),
        ("ix_shipments_tracking_number_trgm",    "shipments", "tracking_number"),
    ]
    for name, table, col in trgm_indexes:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {name} "
            f"ON {table} USING gin ({col} gin_trgm_ops)"
        )

    # ── 0033_shipment_replacements ───────────────────────────────────────────
    # Drop unique constraint on order_id if it still exists
    for uc in sa.inspect(bind).get_unique_constraints("shipments"):
        if uc.get("column_names") == ["order_id"]:
            op.drop_constraint(uc["name"], "shipments", type_="unique")
            break

    if not _column_exists(bind, "shipments", "replacement_sequence"):
        op.add_column(
            "shipments",
            sa.Column(
                "replacement_sequence",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
        )

    if not _column_exists(bind, "shipments", "replacement_reason"):
        op.add_column("shipments", sa.Column("replacement_reason", sa.Text(), nullable=True))

    if not _column_exists(bind, "shipments", "replaces_shipment_id"):
        op.add_column("shipments", sa.Column("replaces_shipment_id", sa.Integer(), nullable=True))

    if not _fk_exists(bind, "shipments", "fk_shipments_replaces_shipment_id"):
        op.create_foreign_key(
            "fk_shipments_replaces_shipment_id",
            "shipments",
            "shipments",
            ["replaces_shipment_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _index_exists(bind, "shipments", "ix_shipments_order_id_sequence"):
        op.create_index(
            "ix_shipments_order_id_sequence",
            "shipments",
            ["order_id", "replacement_sequence"],
        )

    if not _column_exists(bind, "shipments", "is_cost_pending"):
        op.add_column(
            "shipments",
            sa.Column(
                "is_cost_pending",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    if not _column_exists(bind, "shipments", "shopify_fulfillment_cancelled_at"):
        op.add_column(
            "shipments",
            sa.Column(
                "shopify_fulfillment_cancelled_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )


def downgrade() -> None:
    # This is a catch-up migration — downgrade is a no-op to avoid
    # re-breaking the schema if rolled back.
    pass
