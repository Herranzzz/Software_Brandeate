from __future__ import annotations

import json
import ssl
import threading
import time
from urllib import error, request
from urllib.parse import urlencode

from app.core.config import get_settings


def _ssl_context() -> ssl.SSLContext | None:
    """Return an unverified SSL context for test environments."""
    if not get_settings().ctt_ssl_verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


_token_lock = threading.Lock()
_cached_token: str | None = None
_token_expires_at: float = 0.0


class CTTError(Exception):
    pass


def _base_url() -> str:
    return get_settings().ctt_api_base_url.rstrip("/")


def get_token() -> str:
    global _cached_token, _token_expires_at

    with _token_lock:
        if _cached_token and time.time() < _token_expires_at:
            return _cached_token

        settings = get_settings()
        if not settings.ctt_client_id or not settings.ctt_client_secret:
            raise CTTError("CTT credentials not configured (CTT_CLIENT_ID / CTT_CLIENT_SECRET)")

        data = urlencode({
            "client_id": settings.ctt_client_id,
            "client_secret": settings.ctt_client_secret,
            "scope": "urn:com:ctt-express:integration-clients:scopes:common/ALL",
            "grant_type": "client_credentials",
        }).encode()

        req = request.Request(
            f"{_base_url()}/integrations/oauth2/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with request.urlopen(req, context=_ssl_context()) as resp:
                payload = json.loads(resp.read())
        except error.HTTPError as exc:
            raise CTTError(f"Token request failed ({exc.code}): {exc.read().decode()}") from exc

        _cached_token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 86400))
        _token_expires_at = time.time() + expires_in - 60  # 60 s safety margin
        return _cached_token


def create_shipping(shipping_data: dict) -> dict:
    token = get_token()
    body = json.dumps(shipping_data).encode()
    req = request.Request(
        f"{_base_url()}/integrations/manifest/v2.0/shippings",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, context=_ssl_context()) as resp:
            return json.loads(resp.read())
    except error.HTTPError as exc:
        raise CTTError(f"Create shipping failed ({exc.code}): {exc.read().decode()}") from exc


def get_label(tracking_code: str, label_type: str = "PDF") -> bytes:
    import base64

    token = get_token()
    params = urlencode({
        "label_type_code": label_type,
        "model_type_code": "MULTI4",
        "label_offset": "1",
    })
    url = (
        f"{_base_url()}/integrations/trf/labelling/v1.0/shippings"
        f"/{tracking_code}/shipping-labels?{params}"
    )
    req = request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with request.urlopen(req, context=_ssl_context()) as resp:
            raw = resp.read()
    except error.HTTPError as exc:
        raise CTTError(f"Get label failed ({exc.code}): {exc.read().decode()}") from exc

    # CTT returns JSON with base64-encoded PDF in data[0].label
    try:
        payload = json.loads(raw)
        b64 = payload["data"][0]["label"]
        return base64.b64decode(b64)
    except (KeyError, IndexError, ValueError):
        # If it's already binary PDF, return as-is
        return raw
