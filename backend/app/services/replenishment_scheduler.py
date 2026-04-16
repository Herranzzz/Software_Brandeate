"""Daily scheduler that auto-generates draft POs for shops with auto-replenishment enabled.

Runs once every REPLENISHMENT_SYNC_INTERVAL_HOURS (default 24). For each shop
with inventory items flagged `replenishment_auto_enabled=True`, it computes
recommendations and creates draft POs grouped by primary supplier.

The generated POs stay in status='draft' — a human must review and send them.
"""

from __future__ import annotations

import logging
import os
import threading

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import InventoryItem
from app.services.purchase_orders import generate_pos_from_recommendations
from app.services.replenishment_engine import compute_recommendations_for_shop

logger = logging.getLogger(__name__)

_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _interval_seconds() -> int:
    try:
        return max(3600, int(os.environ.get("REPLENISHMENT_SYNC_INTERVAL_HOURS", "24")) * 3600)
    except ValueError:
        return 24 * 3600


def run_once() -> dict:
    """Single run — process all shops that have at least one item with auto-replenishment."""
    created_pos = 0
    shops_processed = 0
    with SessionLocal() as db:
        shop_ids = [
            row[0]
            for row in db.execute(
                select(InventoryItem.shop_id)
                .where(InventoryItem.replenishment_auto_enabled.is_(True))
                .distinct()
            ).all()
        ]
        for shop_id in shop_ids:
            recs = compute_recommendations_for_shop(db, shop_id, only_auto_enabled=True)
            if not recs:
                continue
            # Only create POs for critical/high urgency items to avoid over-ordering
            actionable = [r for r in recs if r.urgency in ("critical", "high")]
            if not actionable:
                continue
            pos = generate_pos_from_recommendations(
                db, shop_id, actionable, auto_generated=True
            )
            created_pos += len(pos)
            shops_processed += 1
            db.commit()

    return {"shops_processed": shops_processed, "pos_created": created_pos}


def _run_loop() -> None:
    interval = _interval_seconds()
    logger.info("Replenishment scheduler started (interval=%ds)", interval)
    while not _stop_event.wait(interval):
        try:
            result = run_once()
            if result["pos_created"]:
                logger.info("Replenishment: %s", result)
        except Exception:
            logger.exception("Replenishment scheduler run failed")


def start() -> None:
    global _thread
    if not os.environ.get("REPLENISHMENT_SYNC_ENABLED", "true").lower().startswith("t"):
        logger.info("Replenishment scheduler disabled via REPLENISHMENT_SYNC_ENABLED")
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(
        target=_run_loop, name="replenishment-scheduler", daemon=True
    )
    _thread.start()


def stop() -> None:
    _stop_event.set()
