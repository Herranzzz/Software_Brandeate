"""merge: unify trgm-search branch with main migration line

Two heads existed after pushing the search-trgm work:
  - 0046_email_flow_drafts (main line)
  - 0033_shipment_replacements (end of perf-index/trgm branch)

Chain B: 0031_perf_indexes → 0032_search_trgm_indexes → 0033_shipment_replacements

This empty merge revision connects them so alembic has a single head again.

Revision ID: 0047_merge_heads
Revises: 0046_email_flow_drafts, 0033_shipment_replacements
Create Date: 2026-04-28
"""

from __future__ import annotations


revision = "0047_merge_heads"
down_revision = ("0046_email_flow_drafts", "0033_shipment_replacements")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
