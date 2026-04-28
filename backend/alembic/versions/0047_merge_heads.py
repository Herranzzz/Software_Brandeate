"""merge: unify trgm-search branch with main migration line

Two heads existed after pushing the search-trgm work:
  - 0046_email_flow_drafts (main line)
  - 0032_search_trgm_indexes (branched off 0030 alongside 0031_inventory_sga)

This empty merge revision connects them so alembic has a single head again.
The trgm + perf-index migrations are idempotent (IF NOT EXISTS) and run
naturally as alembic walks the previously-orphaned branch.

Revision ID: 0047_merge_heads
Revises: 0046_email_flow_drafts, 0032_search_trgm_indexes
Create Date: 2026-04-28
"""

from __future__ import annotations


revision = "0047_merge_heads"
down_revision = ("0046_email_flow_drafts", "0032_search_trgm_indexes")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
