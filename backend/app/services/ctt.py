from __future__ import annotations

import logging
import random
import threading
import time
from typing import Any

import httpx

from app.core.config import get_settings


logger = logging.getLogger(__name__)


# Hard timeout (seconds) applied to every outbound HTTP request to CTT.
# Without this, calls block indefinitely when CTT is slow or unreachable,
# which in turn makes the bulk label download in the UI hang forever.
_CTT_TOKEN_TIMEOUT_SECONDS = 12
_CTT_REQUEST_TIMEOUT_SECONDS = 20
_CTT_LABEL_TIMEOUT_SECONDS = 20

# Transient-error retry policy. CTT's gateway returns sporadic 502/503/504 and
# drops connections under load; retrying with backoff turns those into invisible
# hiccups instead of user-facing failures. 4xx is NOT retried — those are
# business errors (bad payload, auth) that won't recover on retry.
# 2 attempts (1 retry) keeps total wall time bounded so the frontend timeout
# never fires while the backend is still trying — worst case ~ timeout * 2 + 1.2s.
_RETRY_MAX_ATTEMPTS = 2
_RETRY_BASE_DELAY = 0.6
_RETRY_MAX_DELAY = 2.0
_RETRY_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})


class CTTError(Exception):
    pass


class CTTHTTPError(CTTError):
    """A non-2xx response from CTT after retries are exhausted.

    Carries enough context (status, body) for callers to format meaningful
    error messages without a second round-trip.
    """

    def __init__(self, status_code: int, body: str, *, url: str = "") -> None:
        self.status_code = status_code
        self.body = body
        self.url = url
        super().__init__(f"CTT HTTP {status_code} for {url}: {body[:300]}")


# ── Shared HTTP client ────────────────────────────────────────────────────
#
# A single module-level httpx.Client gives us connection pooling: TLS
# handshakes (~200ms each) are paid once per host then reused for the next
# call. Critical for bulk label flows where we make 8 concurrent requests to
# the same CTT host.
#
# The client is built lazily so that get_settings() is read after env vars
# load, and recycled if ctt_ssl_verify changes (test ↔ prod swaps).

_client_lock = threading.Lock()
_client: httpx.Client | None = None
_client_verify: bool | None = None


def _get_client() -> httpx.Client:
    global _client, _client_verify
    settings = get_settings()
    verify = settings.ctt_ssl_verify
    with _client_lock:
        if _client is None or _client_verify != verify:
            if _client is not None:
                try:
                    _client.close()
                except Exception:
                    pass
            _client = httpx.Client(
                verify=verify,
                # Match _BULK_CTT_CONCURRENCY upstream so 8 parallel callers
                # never block on connection acquisition.
                limits=httpx.Limits(
                    max_connections=16,
                    max_keepalive_connections=10,
                    keepalive_expiry=60.0,
                ),
                # Default; per-request timeouts override below.
                timeout=httpx.Timeout(_CTT_REQUEST_TIMEOUT_SECONDS),
                follow_redirects=False,
            )
            _client_verify = verify
        return _client


# ── Token cache ───────────────────────────────────────────────────────────

_token_lock = threading.Lock()
# Keyed by base_url so switching between test and production environments
# (CTT_API_BASE_URL env var) always fetches a fresh token for that environment.
_token_cache: dict[str, tuple[str, float]] = {}  # base_url -> (token, expires_at)


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


# ── Core HTTP helper ──────────────────────────────────────────────────────


def _send_with_retry(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    content: bytes | None = None,
    timeout: float,
    op_label: str,
) -> httpx.Response:
    """Send an HTTP request with bounded exponential backoff on transient failures.

    Returns the httpx.Response on 2xx. Raises CTTHTTPError on non-retried
    non-2xx, CTTError on terminal transport failure. Connection reuse is
    automatic via the shared client.
    """
    client = _get_client()
    last_exc: Exception | None = None

    for attempt in range(1, _RETRY_MAX_ATTEMPTS + 1):
        try:
            response = client.request(
                method,
                url,
                headers=headers,
                content=content,
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            last_exc = exc
            if attempt == _RETRY_MAX_ATTEMPTS:
                raise CTTError(
                    f"CTT request timed out after {timeout}s on {op_label}"
                ) from exc
            logger.warning(
                "CTT timeout on %s (attempt %s/%s), retrying",
                op_label, attempt, _RETRY_MAX_ATTEMPTS,
            )
        except httpx.RequestError as exc:
            # Connection refused, DNS, TLS handshake — all transient enough
            # for one retry, but not so hopeful we should hammer.
            last_exc = exc
            if attempt == _RETRY_MAX_ATTEMPTS:
                raise CTTError(
                    f"CTT network error on {op_label}: {exc!s}"
                ) from exc
            logger.warning(
                "CTT network error on %s (%s, attempt %s/%s), retrying",
                op_label, exc, attempt, _RETRY_MAX_ATTEMPTS,
            )
        else:
            if 200 <= response.status_code < 300:
                return response
            if response.status_code in _RETRY_STATUS_CODES and attempt < _RETRY_MAX_ATTEMPTS:
                logger.warning(
                    "CTT transient HTTP %s on %s (attempt %s/%s), retrying",
                    response.status_code, op_label, attempt, _RETRY_MAX_ATTEMPTS,
                )
            else:
                # Non-retried error or final attempt — surface to caller.
                raise CTTHTTPError(
                    response.status_code,
                    response.text or "",
                    url=op_label,
                )

        delay = min(_RETRY_BASE_DELAY * (2 ** (attempt - 1)), _RETRY_MAX_DELAY)
        delay += random.uniform(0, delay * 0.25)
        time.sleep(delay)

    # Unreachable — loop either returns or raises.
    assert last_exc is not None
    raise CTTError(f"CTT request failed on {op_label}: {last_exc!s}") from last_exc


# ── Public API ────────────────────────────────────────────────────────────


def get_token() -> str:
    base = _base_url()

    with _token_lock:
        cached = _token_cache.get(base)
        if cached and time.time() < cached[1]:
            return cached[0]

        settings = get_settings()
        if not settings.ctt_client_id or not settings.ctt_client_secret:
            raise CTTError("CTT credentials not configured (CTT_CLIENT_ID / CTT_CLIENT_SECRET)")

        # CTT always uses client_credentials for the token.
        # user_name + password are sent as HTTP headers on each API request (see _api_headers).
        try:
            response = _send_with_retry(
                "POST",
                f"{base}/integrations/oauth2/token",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                content=httpx.QueryParams({
                    "client_id": settings.ctt_client_id,
                    "client_secret": settings.ctt_client_secret,
                    "scope": "urn:com:ctt-express:integration-clients:scopes:common/ALL",
                    "grant_type": "client_credentials",
                }).render().encode(),
                timeout=_CTT_TOKEN_TIMEOUT_SECONDS,
                op_label=f"POST {base}/oauth2/token",
            )
        except CTTHTTPError as exc:
            raise CTTError(
                f"Token request failed ({exc.status_code}) for {base}: {exc.body}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise CTTError(f"Token response was not JSON: {response.text[:300]}") from exc

        token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 86400))
        _token_cache[base] = (token, time.time() + expires_in - 60)  # 60 s safety margin
        return token


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
    params = {
        "view": view,
        "showItems": str(show_items).lower(),
    }
    qs = httpx.QueryParams(params).render()
    return _request_json(
        method="GET",
        path=f"/integrations-info/trf/item-history-api/history/{tracking_code}?{qs}",
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
    qs = httpx.QueryParams({
        "page_limit": page_limit,
        "page_offsets": page_offsets,
        "mapping_table_code": mapping_table_code,
        "order_by": order_by,
        "client_center_code": client_center_code,
        "shipping_date": shipping_date,
    }).render()
    return _request_json(
        method="GET",
        path=f"/integrations/trf/web-tracking/v1.0/shippings?{qs}",
    )


def _request_json(
    *,
    method: str,
    path: str,
    body: dict | None = None,
) -> dict:
    import json as _json

    token = get_token()
    raw_body = _json.dumps(body).encode() if body is not None else None
    try:
        response = _send_with_retry(
            method,
            f"{_base_url()}{path}",
            headers=_api_headers(token=token, include_content_type=True),
            content=raw_body,
            timeout=_CTT_REQUEST_TIMEOUT_SECONDS,
            op_label=f"{method} {path}",
        )
    except CTTHTTPError as exc:
        raise CTTError(
            f"CTT request failed ({exc.status_code}) {method} {path}: {exc.body}"
        ) from exc

    try:
        return response.json()
    except ValueError as exc:
        preview = response.text[:400].strip()
        raise CTTError(
            f"CTT returned a non-JSON response for {method} {path}: {preview or '[empty body]'}"
        ) from exc


def get_label(
    tracking_code: str,
    label_type: str = "PDF",
    model_type: str = "SINGLE",
) -> bytes:
    import base64
    import json as _json

    token = get_token()
    qs = httpx.QueryParams({
        "label_type_code": label_type,
        "model_type_code": model_type,
        "label_offset": "1",
    }).render()
    url = (
        f"{_base_url()}/integrations/trf/labelling/v1.0/shippings"
        f"/{tracking_code}/shipping-labels?{qs}"
    )
    try:
        response = _send_with_retry(
            "GET",
            url,
            headers=_api_headers(token=token),
            timeout=_CTT_LABEL_TIMEOUT_SECONDS,
            op_label=f"GET label {tracking_code}",
        )
    except CTTHTTPError as exc:
        raise CTTError(
            f"Get label failed ({exc.status_code}): {exc.body}"
        ) from exc

    raw = response.content
    # CTT returns JSON with base64-encoded PDF in data[0].label
    try:
        payload = _json.loads(raw)
        b64 = payload["data"][0]["label"]
        return base64.b64decode(b64)
    except (KeyError, IndexError, ValueError):
        # If it's already binary PDF, return as-is
        return raw


def get_pod(
    tracking_code: str,
    client_center_code: str,
    destination_postal_code: str,
) -> bytes | None:
    """Get Proof of Delivery (POD) PDF for a delivered shipment.

    CTT POD API: GET /cls/pods/{shipping_code}?client_center_code=...&hash=...
    Hash = MD5(shipping_code + client_center_code + destination_postal_code)

    Returns the PDF bytes, or None if no POD is available yet.
    """
    import hashlib as _hashlib

    hash_input = f"{tracking_code}{client_center_code}{destination_postal_code}"
    pod_hash = _hashlib.md5(hash_input.encode()).hexdigest()

    token = get_token()
    qs = httpx.QueryParams({
        "client_center_code": client_center_code,
        "hash": pod_hash,
    }).render()
    url = f"{_base_url()}/cls/pods/{tracking_code}?{qs}"
    try:
        response = _send_with_retry(
            "GET",
            url,
            headers=_api_headers(token=token),
            timeout=_CTT_LABEL_TIMEOUT_SECONDS,
            op_label=f"GET pod {tracking_code}",
        )
    except CTTHTTPError as exc:
        if exc.status_code == 404:
            return None
        raise CTTError(f"Get POD failed ({exc.status_code}): {exc.body}") from exc

    return response.content


def get_pickup_points(
    postal_code: str,
    country_code: str = "ES",
    page_limit: int = 20,
) -> list[dict]:
    """Search CTT PUDO (pickup) points by postal code prefix.

    Uses CTT distribution-points v2.0 API.
    Returns a list of raw point dicts from the API.
    """
    import json as _json

    token = get_token()
    qs = httpx.QueryParams({"page_limit": page_limit, "page_offsets": 0}).render()
    url = (
        f"{_base_url()}/integrations/delivery/v1.0"
        f"/distribution-points/v2.0/search?{qs}"
    )
    body = _json.dumps({
        "area": {
            "postal_code": postal_code,
            "country_code": country_code,
        },
        "type": "OFFLINE",
        "services": [],
    }).encode()

    try:
        response = _send_with_retry(
            "POST",
            url,
            headers=_api_headers(token=token, include_content_type=True),
            content=body,
            timeout=_CTT_REQUEST_TIMEOUT_SECONDS,
            op_label=f"POST pickup-points {postal_code}",
        )
    except CTTHTTPError as exc:
        raise CTTError(
            f"Get pickup points failed ({exc.status_code}): {exc.body}"
        ) from exc

    payload: Any = response.json()
    # Response may be list or dict with a key containing the list
    if isinstance(payload, list):
        return payload
    for key in ("distribution_points", "points", "data", "items", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []
