"""Outgoing webhook dispatch service."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any

import urllib.request
import urllib.error

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.webhook_endpoint import WebhookEndpoint

logger = logging.getLogger(__name__)


def dispatch_webhook(
    db: Session,
    *,
    shop_id: int,
    event: str,
    payload: dict[str, Any],
) -> None:
    """Find active endpoints matching shop + event and fire them in background threads."""
    endpoints = list(
        db.scalars(
            select(WebhookEndpoint)
            .where(
                WebhookEndpoint.shop_id == shop_id,
                WebhookEndpoint.is_active.is_(True),
            )
        )
    )

    matched = [ep for ep in endpoints if event in (ep.events or [])]
    if not matched:
        return

    body = json.dumps({"event": event, "payload": payload}, default=str)

    for ep in matched:
        threading.Thread(
            target=_send_webhook,
            args=(ep.id, ep.url, ep.secret, body),
            daemon=True,
        ).start()


def _send_webhook(endpoint_id: int, url: str, secret: str | None, body: str) -> None:
    """POST the webhook payload and record the result."""
    headers = {"Content-Type": "application/json"}
    if secret:
        signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-Webhook-Signature"] = signature

    status_code: int | None = None
    error: str | None = None

    try:
        req = urllib.request.Request(url, data=body.encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            status_code = resp.status
    except urllib.error.HTTPError as e:
        status_code = e.code
        error = str(e.reason)[:500]
    except Exception as e:
        error = str(e)[:500]

    # Record result
    try:
        session = SessionLocal()
        ep = session.get(WebhookEndpoint, endpoint_id)
        if ep:
            ep.last_triggered_at = datetime.now(timezone.utc)
            ep.last_status_code = status_code
            ep.last_error = error
            session.commit()
        session.close()
    except Exception:
        logger.exception("Failed to record webhook result for endpoint %d", endpoint_id)


def send_test_webhook(endpoint: WebhookEndpoint) -> dict[str, Any]:
    """Send a test payload synchronously and return the result."""
    body = json.dumps({
        "event": "test",
        "payload": {"message": "This is a test webhook from Brandeate"},
    })

    headers = {"Content-Type": "application/json"}
    if endpoint.secret:
        signature = hmac.new(endpoint.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-Webhook-Signature"] = signature

    try:
        req = urllib.request.Request(endpoint.url, data=body.encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"success": True, "status_code": resp.status}
    except urllib.error.HTTPError as e:
        return {"success": False, "status_code": e.code, "error": str(e.reason)[:500]}
    except Exception as e:
        return {"success": False, "status_code": None, "error": str(e)[:500]}
