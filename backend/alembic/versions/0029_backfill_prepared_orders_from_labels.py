"""backfill prepared orders from existing shipment labels

Revision ID: 0029_prepared_orders_backfill
Revises: 0028_employee_activity
Create Date: 2026-04-10 13:05:00.000000
"""

from alembic import op


revision = "0029_prepared_orders_backfill"
down_revision = "0028_employee_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Historical fix:
    # if an order already has a shipment label/tracking, mark it as prepared.
    # This is idempotent and only updates rows that still need normalization.
    op.execute(
        """
        UPDATE orders
        SET
            production_status = CASE
                WHEN production_status IN ('pending_personalization', 'in_production')
                    THEN 'packed'
                ELSE production_status
            END,
            prepared_at = COALESCE(
                prepared_at,
                (SELECT s.label_created_at FROM shipments s WHERE s.order_id = orders.id),
                (SELECT s.created_at FROM shipments s WHERE s.order_id = orders.id),
                CURRENT_TIMESTAMP
            ),
            prepared_by_employee_id = COALESCE(
                prepared_by_employee_id,
                (SELECT s.created_by_employee_id FROM shipments s WHERE s.order_id = orders.id)
            )
        WHERE EXISTS (
            SELECT 1
            FROM shipments s
            WHERE s.order_id = orders.id
              AND COALESCE(TRIM(s.tracking_number), '') <> ''
        )
          AND (
            production_status IN ('pending_personalization', 'in_production')
            OR prepared_at IS NULL
            OR prepared_by_employee_id IS NULL
          )
        """
    )


def downgrade() -> None:
    # Data backfill migration: no destructive rollback.
    pass
