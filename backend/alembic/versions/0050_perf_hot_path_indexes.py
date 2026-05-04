"""perf: indexes on hot list-query columns

Adds indexes for the operator workbench's hottest queries:

  • orders.status            — every list filter & dashboard tile filters by it
  • orders.production_status — print-queue / preparing list filters by it
  • orders(shop_id, created_at DESC) — paginated list ORDER BY
  • shipments(order_id, replacement_sequence DESC) — "active shipment" lookup

Without these indexes Postgres falls back to sequential scans on the orders
table; with ~50k+ rows this is what makes the orders/dashboard pages slow
and what causes lock-timeout-related crashes during bulk status updates.

All operations are idempotent (IF NOT EXISTS via raw SQL) so the migration
is safe to re-run on environments where the indexes were created manually.

Revision ID: 0050
Revises: 0049
Create Date: 2026-04-30
"""

from __future__ import annotations

from alembic import op


revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


# We use raw SQL with IF NOT EXISTS so re-runs on environments that already
# have the index (e.g. created by a DBA, or partially-applied prior runs)
# don't fail. Alembic's op.create_index() does not support IF NOT EXISTS.
INDEXES: list[tuple[str, str]] = [
    (
        "ix_orders_status",
        "CREATE INDEX IF NOT EXISTS ix_orders_status ON orders (status)",
    ),
    (
        "ix_orders_production_status",
        "CREATE INDEX IF NOT EXISTS ix_orders_production_status ON orders (production_status)",
    ),
    # Composite for paginated listings: WHERE shop_id = ? ORDER BY created_at DESC, id DESC
    (
        "ix_orders_shop_created_at",
        "CREATE INDEX IF NOT EXISTS ix_orders_shop_created_at "
        "ON orders (shop_id, created_at DESC, id DESC)",
    ),
    # Composite for "find active shipment of an order" — highest replacement_sequence wins
    (
        "ix_shipments_order_replacement_seq",
        "CREATE INDEX IF NOT EXISTS ix_shipments_order_replacement_seq "
        "ON shipments (order_id, replacement_sequence DESC)",
    ),
]


def upgrade() -> None:
    bind = op.get_bind()
    for _name, sql in INDEXES:
        bind.exec_driver_sql(sql)


def downgrade() -> None:
    bind = op.get_bind()
    for name, _sql in INDEXES:
        bind.exec_driver_sql(f"DROP INDEX IF EXISTS {name}")
