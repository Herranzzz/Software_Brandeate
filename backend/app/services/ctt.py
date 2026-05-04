from __future__ import annotations

import json
import logging
import random
import socket
import ssl
import threading
import time
from urllib import error, request
from urllib.parse import urlencode

from app.core.config import get_settings


logger = logging.getLogger(__name__)


# Hard timeout (seconds) applied to every outbound HTTP request to CTT.
# Without this, urlopen() blocks indefinitely when CTT is slow or unreachable,
# which in turn makes the bulk label download in the UI hang forever.
_CTT_TOKEN_TIMEOUT_SECONDS = 15
_CTT_REQUEST_TIMEOUT_SECONDS = 25
_CTT_LABEL_TIMEOUT_SECONDS = 30

# Transient-error retry policy. CTT's gateway returns sporadic 502/503/504 and
# drops connections under load; retrying with backoff turns those into invisible
# hiccups instead of user-facing failures. 4xx is NOT retried — those are
# business errors (bad payload, auth) that won't recover on retry.
_RETRY_MAX_ATTEMPTS = 3
_RETRY_BASE_DELAY = 0.6
_RETRY_MAX_DELAY = 4.0
_RETRY_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
# Hard upper bound for a single _urlopen_with_retry call regardless of how many
# retries happen. Without it, a slow CTT gateway can block a worker thread for
# minutes (per_attempt_timeout × attempts + backoff) and exhaust the thread
# pool used by the bulk-label endpoint. 75s is generous given the per-attempt
# timeout we use (max 30s for label fetches × 3 retries + 4s backoff = ~98s),
# while still leaving Render's request timeout headroom.
_OVERALL_DEADLINE_S = 75.0


def _ssl_context() -> ssl.SSLContext | None:
    """Return an unverified SSL context for test environments."""
    if not get_settings().ctt_ssl_verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


def _is_transient_urlerror(exc: error.URLError) -> bool:
    """URL errors wrap the underlying socket/OS error in `reason`.

    Connection resets, DNS hiccups, and timeouts are transient; refuse to retry
    anything else (e.g. SSL certificate problems won't improve on retry).
    """
    reason = getattr(exc, "reason", None)
    if isinstance(reason, (socket.timeout, TimeoutError, ConnectionError)):
        return True
    if isinstance(reason, OSError):
        # EHOSTUNREACH, ECONNREFUSED, ENETUNREACH, etc.
        return True
    return False


def _urlopen_with_retry(
    req: request.Request,
    *,
    timeout: int,
    op_label: str,
) -> bytes:
    """Execute `urlopen(req)` with bounded exponential backoff on transient failures.

    Returns the response body bytes. Raises the original exception after the
    final attempt. Non-transient errors (4xx HTTPError, SSL, invalid URL) are
    raised immediately without retry.
    """
    started = time.monotonic()
    deadline = started + _OVERALL_DEADLINE_S
    last_exc: Exception | None = None
    for attempt in range(1, _RETRY_MAX_ATTEMPTS + 1):
        # Cap per-attempt timeout so the overall call cannot exceed the
        # deadline even if the underlying socket would happily wait longer.
        remaining = max(1.0, deadline - time.monotonic())
        attempt_timeout = min(timeout, remaining)
        try:
            with request.urlopen(req, context=_ssl_context(), timeout=attempt_timeout) as resp:
                return resp.read()
        except error.HTTPError as exc:
            last_exc = exc
            if exc.code not in _RETRY_STATUS_CODES or attempt == _RETRY_MAX_ATTEMPTS:
                raise
            logger.warning(
                "CTT transient HTTP %s on %s (attempt %s/%s), retrying",
                exc.code, op_label, attempt, _RETRY_MAX_ATTEMPTS,
            )
        except (socket.timeout, TimeoutError) as exc:
            last_exc = exc
            if attempt == _RETRY_MAX_ATTEMPTS:
                raise
            logger.warning(
                "CTT timeout on %s (attempt %s/%s), retrying",
                op_label, attempt, _RETRY_MAX_ATTEMPTS,
            )
        except error.URLError as exc:
            last_exc = exc
            if not _is_transient_urlerror(exc) or attempt == _RETRY_MAX_ATTEMPTS:
                raise
            logger.warning(
                "CTT network error on %s (%s, attempt %s/%s), retrying",
                op_label, exc.reason, attempt, _RETRY_MAX_ATTEMPTS,
            )

        # Bail out if we wouldn't have time for another attempt anyway.
        if time.monotonic() >= deadline:
            logger.warning(
                "CTT overall deadline reached on %s after %.1fs, aborting retries",
                op_label, time.monotonic() - started,
            )
            raise last_exc

        delay = min(_RETRY_BASE_DELAY * (2 ** (attempt - 1)), _RETRY_MAX_DELAY)
        delay += random.uniform(0, delay * 0.25)
        # Don't sleep past the deadline — would just delay the inevitable raise.
        delay = min(delay, max(0.0, deadline - time.monotonic() - 0.1))
        if delay > 0:
            time.sleep(delay)

    # unreachable — loop either returns or raises
    assert last_exc is not None
    raise last_exc


_token_lock = threading.Lock()
# Keyed by base_url so switching between test and production environments
# (CTT_API_BASE_URL env var) always fetches a fresh token for that environment.
_token_cache: dict[str, tuple[str, float]] = {}  # base_url -> (token, expires_at)


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
        data = urlencode({
            "client_id": settings.ctt_client_id,
            "client_secret": settings.ctt_client_secret,
            "scope": "urn:com:ctt-express:integration-clients:scopes:common/ALL",
            "grant_type": "client_credentials",
        }).encode()

        req = request.Request(
            f"{base}/integrations/oauth2/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            raw = _urlopen_with_retry(
                req,
                timeout=_CTT_TOKEN_TIMEOUT_SECONDS,
                op_label=f"POST {base}/oauth2/token",
            )
            payload = json.loads(raw)
        except error.HTTPError as exc:
            raise CTTError(
                f"Token request failed ({exc.code}) for {base}: {exc.read().decode()}"
            ) from exc
        except (socket.timeout, TimeoutError) as exc:
            raise CTTError(
                f"Token request timed out after {_CTT_TOKEN_TIMEOUT_SECONDS}s for {base}"
            ) from exc
        except error.URLError as exc:
            raise CTTError(
                f"Token request network error for {base}: {exc.reason}"
            ) from exc

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
        raw = _urlopen_with_retry(
            req,
            timeout=_CTT_REQUEST_TIMEOUT_SECONDS,
            op_label=f"{method} {path}",
        )
    except error.HTTPError as exc:
        raise CTTError(f"CTT request failed ({exc.code}) {method} {path}: {exc.read().decode()}") from exc
    except (socket.timeout, TimeoutError) as exc:
        raise CTTError(
            f"CTT request timed out after {_CTT_REQUEST_TIMEOUT_SECONDS}s {method} {path}"
        ) from exc
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
        raw = _urlopen_with_retry(
            req,
            timeout=_CTT_LABEL_TIMEOUT_SECONDS,
            op_label=f"GET label {tracking_code}",
        )
    except error.HTTPError as exc:
        raise CTTError(f"Get label failed ({exc.code}): {exc.read().decode()}") from exc
    except (socket.timeout, TimeoutError) as exc:
        raise CTTError(
            f"Get label timed out after {_CTT_LABEL_TIMEOUT_SECONDS}s for {tracking_code}"
        ) from exc
    except error.URLError as exc:
        raise CTTError(
            f"Get label network error for {tracking_code}: {exc.reason}"
        ) from exc

    # CTT returns JSON with base64-encoded PDF in data[0].label
    try:
        payload = json.loads(raw)
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
    params = urlencode({
        "client_center_code": client_center_code,
        "hash": pod_hash,
    })
    url = f"{_base_url()}/cls/pods/{tracking_code}?{params}"
    req = request.Request(
        url,
        headers=_api_headers(token=token),
        method="GET",
    )
    try:
        return _urlopen_with_retry(
            req,
            timeout=_CTT_LABEL_TIMEOUT_SECONDS,
            op_label=f"GET pod {tracking_code}",
        )
    except error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise CTTError(f"Get POD failed ({exc.code}): {exc.read().decode()}") from exc
    except (socket.timeout, TimeoutError) as exc:
        raise CTTError(
            f"Get POD timed out after {_CTT_LABEL_TIMEOUT_SECONDS}s for {tracking_code}"
        ) from exc
    except error.URLError as exc:
        raise CTTError(
            f"Get POD network error for {tracking_code}: {exc.reason}"
        ) from exc


def get_pickup_points(
    postal_code: str,
    country_code: str = "ES",
    page_limit: int = 20,
) -> list[dict]:
    """Search CTT PUDO (pickup) points by postal code prefix.

    Uses CTT distribution-points v2.0 API.
    Returns a list of raw point dicts from the API.
    """
    token = get_token()
    params = urlencode({"page_limit": page_limit, "page_offsets": 0})
    url = (
        f"{_base_url()}/integrations/delivery/v1.0"
        f"/distribution-points/v2.0/search?{params}"
    )
    body = json.dumps({
        "area": {
            "postal_code": postal_code,
            "country_code": country_code,
        },
        "type": "OFFLINE",
        "services": [],
    }).encode()

    req = request.Request(
        url,
        data=body,
        headers=_api_headers(token=token, include_content_type=True),
        method="POST",
    )
    try:
        raw = _urlopen_with_retry(
            req,
            timeout=_CTT_REQUEST_TIMEOUT_SECONDS,
            op_label=f"POST pickup-points {postal_code}",
        )
    except error.HTTPError as exc:
        raise CTTError(
            f"Get pickup points failed ({exc.code}): {exc.read().decode()}"
        ) from exc
    except (socket.timeout, TimeoutError) as exc:
        raise CTTError(
            f"Get pickup points timed out after {_CTT_REQUEST_TIMEOUT_SECONDS}s"
        ) from exc
    except error.URLError as exc:
        raise CTTError(
            f"Get pickup points network error: {exc.reason}"
        ) from exc

    payload = json.loads(raw)
    # Response may be list or dict with a key containing the list
    if isinstance(payload, list):
        return payload
    for key in ("distribution_points", "points", "data", "items", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []
