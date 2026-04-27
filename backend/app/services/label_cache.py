"""Filesystem cache for CTT label PDFs.

Once CTT issues a shipping label, its content for a given (tracking_code,
label_type, model_type) tuple is immutable. Re-fetching it on every reprint
costs a 20s round-trip; serving it from disk costs a few milliseconds.

Files older than `label_cache_max_age_days` are considered stale and ignored
(and lazily replaced on the next miss). This bounds disk usage without needing
a separate cleanup job — a forgotten cache will only ever hold ~30 days of
labels at typical warehouse volume.

Writes are atomic (temp file + rename) so a partial write during a crash never
leaves a truncated PDF that would later be served as if it were valid.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import time

from app.core.config import get_settings


logger = logging.getLogger(__name__)

# tracking_code/label_type/model_type are user-supplied; sanitize them before
# letting them anywhere near a filesystem path.
_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize(value: str) -> str:
    cleaned = _SAFE_SEGMENT.sub("_", value or "")
    return cleaned[:120] or "_"


def _cache_path(tracking_code: str, label_type: str, model_type: str) -> str:
    settings = get_settings()
    filename = f"{_sanitize(tracking_code)}__{_sanitize(label_type)}__{_sanitize(model_type)}.bin"
    return os.path.join(settings.label_cache_dir, filename)


def _is_fresh(path: str, max_age_seconds: int) -> bool:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return False
    return (time.time() - mtime) < max_age_seconds


def get_cached_label(tracking_code: str, label_type: str, model_type: str) -> bytes | None:
    """Return cached label bytes if present and fresh; otherwise None."""
    settings = get_settings()
    max_age = settings.label_cache_max_age_days * 86400
    path = _cache_path(tracking_code, label_type, model_type)
    if not _is_fresh(path, max_age):
        return None
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError as exc:
        logger.warning("Label cache read failed for %s: %s", tracking_code, exc)
        return None


def store_label(tracking_code: str, label_type: str, model_type: str, data: bytes) -> None:
    """Persist label bytes atomically. Cache failures are logged and swallowed."""
    if not data:
        return
    settings = get_settings()
    target = _cache_path(tracking_code, label_type, model_type)
    try:
        os.makedirs(settings.label_cache_dir, exist_ok=True)
        # Atomic write: same directory ensures rename is atomic on POSIX.
        fd, tmp_path = tempfile.mkstemp(prefix=".label-", suffix=".tmp", dir=settings.label_cache_dir)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp_path, target)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except OSError as exc:
        # Disk full, permission denied, etc. — never break label generation
        # because the cache layer hiccupped.
        logger.warning("Label cache write failed for %s: %s", tracking_code, exc)


def invalidate_label(tracking_code: str, label_type: str, model_type: str) -> None:
    path = _cache_path(tracking_code, label_type, model_type)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Label cache invalidate failed for %s: %s", tracking_code, exc)
