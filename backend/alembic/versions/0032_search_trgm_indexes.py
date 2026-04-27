"""perf: pg_trgm + GIN trigram indexes for the order search box

The /orders search box does ILIKE '%term%' across 8 columns. Leading-wildcard
ILIKE can't use a btree index → today every search is a full scan of orders +
order_items + shipments. Trigram GIN indexes let Postgres satisfy these
queries from an index instead.

Routing in _search_term_clause (orders.py) already collapses email-/phone-/
tracking-/order-number-shaped queries into a single column lookup; these
indexes cover the remaining free-text fallback.

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-27
"""

from alembic import op


revision = "0032_search_trgm_indexes"
down_revision = "0031_perf_indexes"
branch_labels = None
depends_on = None


# Each entry: (index_name, table, column).
# Kept narrow on purpose — one index per searchable column. GIN indexes are
# bigger than btree but read-cheap and write-cheap enough for a warehouse-
# volume DB.
_TRGM_INDEXES: list[tuple[str, str, str]] = [
    ("ix_orders_external_id_trgm", "orders", "external_id"),
    ("ix_orders_shopify_order_name_trgm", "orders", "shopify_order_name"),
    ("ix_orders_customer_name_trgm", "orders", "customer_name"),
    ("ix_orders_customer_email_trgm", "orders", "customer_email"),
    ("ix_orders_shipping_phone_trgm", "orders", "shipping_phone"),
    ("ix_order_items_sku_trgm", "order_items", "sku"),
    ("ix_order_items_name_trgm", "order_items", "name"),
    ("ix_order_items_title_trgm", "order_items", "title"),
    ("ix_shipments_tracking_number_trgm", "shipments", "tracking_number"),
]


def upgrade() -> None:
    # Render Postgres ships pg_trgm; CREATE EXTENSION is a no-op if present.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, column in _TRGM_INDEXES:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {name} "
            f"ON {table} USING gin ({column} gin_trgm_ops)"
        )


def downgrade() -> None:
    for name, _table, _column in _TRGM_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    # Leave pg_trgm extension installed — other code may rely on it and
    # dropping it on downgrade is hostile to anyone else using it.
