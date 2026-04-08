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


def _api_headers(*, token: str | None = None, include_content_type: bool = False) -> dict[str, str]:
    settings = get_settings()
    headers: dict[str, str] = {}

    if token:
        headers["Authorization"] = f"Bearer {token}"
    if include_content_type:
        headers["Content-Type"] = "application/json"

    if settings.ctt_user_name:
        headers["user_name"] = settings.ctt_user_name
    if settings.ctt_password:
        headers["password"] = settings.ctt_password

    return headers


def get_token() -> str:
    global _cached_token, _token_expires_at

    with _token_lock:
        if _cached_token and time.time() < _token_expires_at:
            return _cached_token

        settings = get_settings()
        if not settings.ctt_client_id or not settings.ctt_client_secret:
            raise CTTError("CTT credentials not configured (CTT_CLIENT_ID / CTT_CLIENT_SECRET)")

        # CTT always uses client_credentials for the token.
        # user_name + password are sent as HTTP headers on each API request (see _api_headers).
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
    return _request_json(
        method="POST",
        path="/integrations/manifest/v2.0/shippings",
        body=shipping_data,
    )


def get_tracking(
    tracking_code: str,
    *,
    view: str = "APITRACK",
    show_items: bool = False,
) -> dict:
    params = urlencode({
        "view": view,
        "showItems": str(show_items).lower(),
    })
    return _request_json(
        method="GET",
        path=f"/integrations-info/trf/item-history-api/history/{tracking_code}?{params}",
    )


def get_trackings_by_date(
    *,
    shipping_date: str,
    client_center_code: str,
    mapping_table_code: str = "APITRACK",
    page_limit: int = 200,
    page_offsets: int = 1,
    order_by: str = "-shipping_date",
) -> dict:
    params = urlencode({
        "page_limit": page_limit,
        "page_offsets": page_offsets,
        "mapping_table_code": mapping_table_code,
        "order_by": order_by,
        "client_center_code": client_center_code,
        "shipping_date": shipping_date,
    })
    return _request_json(
        method="GET",
        path=f"/integrations/trf/web-tracking/v1.0/shippings?{params}",
    )


def _request_json(
    *,
    method: str,
    path: str,
    body: dict | None = None,
) -> dict:
    token = get_token()
    raw_body = json.dumps(body).encode() if body is not None else None
    req = request.Request(
        f"{_base_url()}{path}",
        data=raw_body,
        headers=_api_headers(token=token, include_content_type=True),
        method=method,
    )
    try:
        with request.urlopen(req, context=_ssl_context()) as resp:
            raw = resp.read()
    except error.HTTPError as exc:
        raise CTTError(f"CTT request failed ({exc.code}) {method} {path}: {exc.read().decode()}") from exc
    except error.URLError as exc:
        raise CTTError(f"CTT request network error {method} {path}: {exc.reason}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        preview = raw.decode("utf-8", errors="ignore")[:400].strip()
        raise CTTError(
            f"CTT returned a non-JSON response for {method} {path}: {preview or '[empty body]'}"
        ) from exc


def get_label(
    tracking_code: str,
    label_type: str = "PDF",
    model_type: str = "SINGLE",
) -> bytes:
    import base64

    token = get_token()
    params = urlencode({
        "label_type_code": label_type,
        "model_type_code": model_type,
        "label_offset": "1",
    })
    url = (
        f"{_base_url()}/integrations/trf/labelling/v1.0/shippings"
        f"/{tracking_code}/shipping-labels?{params}"
    )
    req = request.Request(
        url,
        headers=_api_headers(token=token),
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
