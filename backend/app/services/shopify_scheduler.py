from __future__ import annotations

import logging
import threading
from collections.abc import Sequence

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import ShopIntegration
from app.services.automation_rules import reconcile_incident_lifecycle
from app.services.shopify import SHOPIFY_PROVIDER, sync_shopify_shop


logger = logging.getLogger(__name__)


class ShopifySyncScheduler:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._run_lock = threading.Lock()

    def start(self) -> None:
        settings = get_settings()
        if not settings.shopify_sync_enabled:
            logger.info("Shopify scheduler disabled by configuration")
            return

        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_forever, name="shopify-sync-scheduler", daemon=True)
        self._thread.start()
        logger.info("Shopify scheduler started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        logger.info("Shopify scheduler stopped")

    def _run_forever(self) -> None:
        interval_seconds = max(get_settings().shopify_sync_interval_minutes, 1) * 60
        while not self._stop_event.is_set():
            self.run_once()
            if self._stop_event.wait(interval_seconds):
                break

    def run_once(self) -> None:
        if not self._run_lock.acquire(blocking=False):
            logger.info("Shopify scheduler run skipped because another run is still active")
            return

        try:
            for shop_id in self._get_active_shop_ids():
                try:
                    sync_shopify_shop(shop_id, full_sync=False, source="scheduler")
                except Exception:
                    logger.exception("Shopify scheduler sync failed for shop_id=%s", shop_id)

            # Reconcile incident lifecycle after every sync cycle.
            # This replaces the per-request reconciliation that was running on every
            # GET /incidents — bulk SQL UPDATEs belong here, not in read endpoints.
            try:
                with SessionLocal() as db:
                    result = reconcile_incident_lifecycle(db=db)
                    if result["resolved_total"] > 0:
                        db.commit()
                        logger.info(
                            "Incident lifecycle reconcile: %d resolved (terminal=%d, stale=%d)",
                            result["resolved_total"],
                            result["resolved_terminal_orders"],
                            result["resolved_stale"],
                        )
            except Exception:
                logger.exception("Incident lifecycle reconciliation failed in scheduler")
        finally:
            self._run_lock.release()

    def _get_active_shop_ids(self) -> Sequence[int]:
        with SessionLocal() as db:
            return list(
                db.scalars(
                    select(ShopIntegration.shop_id).where(
                        ShopIntegration.provider == SHOPIFY_PROVIDER,
                        ShopIntegration.is_active.is_(True),
                    )
                )
            )


scheduler = ShopifySyncScheduler()
