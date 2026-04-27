"""Lightweight observability: slow-query and slow-request logging.

Without this we have no signal when "the app feels slow" — we'd have to add
print statements after the fact. Now any query > SLOW_QUERY_MS or any HTTP
request > SLOW_REQUEST_MS lands in the logs with enough context to act on:
the SQL or path, plus the elapsed milliseconds.

Thresholds are deliberately permissive (500 ms / 1 s) so normal traffic stays
quiet — only outliers get logged.
"""
from __future__ import annotations

import logging
import time

from sqlalchemy import event
from sqlalchemy.engine import Engine
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


logger = logging.getLogger("brandeate.perf")

SLOW_QUERY_MS = 500
SLOW_REQUEST_MS = 1000


def _truncate(sql: str, limit: int = 400) -> str:
    flat = " ".join(sql.split())
    return flat if len(flat) <= limit else flat[: limit - 3] + "..."


def install_slow_query_logger() -> None:
    """Attach SQLAlchemy event listeners that time every query."""

    @event.listens_for(Engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        context._brandeate_query_start = time.perf_counter()

    @event.listens_for(Engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        start = getattr(context, "_brandeate_query_start", None)
        if start is None:
            return
        elapsed_ms = (time.perf_counter() - start) * 1000
        if elapsed_ms >= SLOW_QUERY_MS:
            logger.warning(
                "slow_query elapsed_ms=%.0f sql=%s",
                elapsed_ms,
                _truncate(statement),
            )


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Log any HTTP request slower than SLOW_REQUEST_MS and emit a header."""

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        start = time.perf_counter()
        response: Response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        # Always expose the timing as a header so we can spot-check from the
        # browser devtools without enabling backend logging.
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.0f}"
        if elapsed_ms >= SLOW_REQUEST_MS:
            logger.warning(
                "slow_request elapsed_ms=%.0f method=%s path=%s status=%s",
                elapsed_ms,
                request.method,
                request.url.path,
                response.status_code,
            )
        return response
