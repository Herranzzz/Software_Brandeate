from __future__ import annotations

import logging
import threading

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.ctt_tracking import sync_ctt_tracking_for_active_shipments


logger = logging.getLogger(__name__)


class CTTTrackingScheduler:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._run_lock = threading.Lock()

    def start(self) -> None:
        settings = get_settings()
        if not settings.ctt_tracking_sync_enabled:
            logger.info("CTT tracking scheduler disabled by configuration")
            return

        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_forever, name="ctt-tracking-scheduler", daemon=True)
        self._thread.start()
        logger.info("CTT tracking scheduler started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        logger.info("CTT tracking scheduler stopped")

    def _run_forever(self) -> None:
        interval_seconds = max(get_settings().ctt_tracking_sync_interval_minutes, 1) * 60
        while not self._stop_event.is_set():
            self.run_once()
            if self._stop_event.wait(interval_seconds):
                break

    def run_once(self) -> None:
        if not self._run_lock.acquire(blocking=False):
            logger.info("CTT tracking scheduler run skipped because another run is still active")
            return

        try:
            with SessionLocal() as db:
                results = sync_ctt_tracking_for_active_shipments(
                    db=db,
                    limit=get_settings().ctt_tracking_sync_batch_size,
                    log_failures=False,
                )
                if results:
                    db.commit()
        except Exception:
            logger.exception("CTT tracking scheduler run failed")
        finally:
            self._run_lock.release()


scheduler = CTTTrackingScheduler()
