"""Scheduler that periodically triggers pending email flows.

Runs every EMAIL_FLOW_SYNC_INTERVAL_MINUTES (default 15) to catch any
orders whose email flows were not fired by the inline event trigger.
"""

from __future__ import annotations

import logging
import os
import threading
import time

from app.db.session import SessionLocal
from app.services.email_flows import run_pending_flows

logger = logging.getLogger(__name__)

_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _interval_minutes() -> int:
    try:
        return max(1, int(os.environ.get("EMAIL_FLOW_SYNC_INTERVAL_MINUTES", "15")))
    except ValueError:
        return 15


def _run_loop() -> None:
    interval = _interval_minutes() * 60
    logger.info("Email flow scheduler started (interval=%ds)", interval)
    while not _stop_event.wait(interval):
        try:
            with SessionLocal() as db:
                result = run_pending_flows(db)
                if result["sent"] or result["failed"]:
                    logger.info("Email flows: %s", result)
        except Exception:
            logger.exception("Email flow scheduler run failed")


def start() -> None:
    global _thread
    if not os.environ.get("EMAIL_FLOW_SYNC_ENABLED", "true").lower().startswith("t"):
        logger.info("Email flow scheduler disabled via EMAIL_FLOW_SYNC_ENABLED")
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_run_loop, name="email-flow-scheduler", daemon=True)
    _thread.start()


def stop() -> None:
    _stop_event.set()
