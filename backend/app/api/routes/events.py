"""Server-Sent Events stream for realtime collaboration.

The browser EventSource API cannot set custom headers, so auth is passed as
the `token` query parameter. The token is identical to the Bearer token used
by the REST API (same `auth_secret`, same decoder).
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.config import get_settings
from app.models import User, UserRole, UserShop
from app.services.auth import decode_access_token
from app.services.realtime import (
    RealtimeEvent,
    get_broker,
    publish_presence,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])

# Heartbeat cadence: Cloudflare / Nginx tend to drop idle HTTP responses after
# ~60s. Sending a comment line every 20s keeps the stream alive and lets the
# client detect a dead connection quickly.
_HEARTBEAT_SECONDS = 20


def _authenticate_sse_user(token: str, db: Session) -> User:
    try:
        claims = decode_access_token(token, get_settings().auth_secret)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc

    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == claims["sub"])
    )
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


@router.get("/stream")
async def stream_events(
    request: Request,
    token: str = Query(..., description="Bearer token (EventSource can't set headers)"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    user = _authenticate_sse_user(token, db)

    if user.role in {UserRole.super_admin, UserRole.ops_admin}:
        shop_ids: frozenset[int] | None = None  # admins see everything
    else:
        shop_ids = frozenset(assignment.shop_id for assignment in user.user_shops)

    user_id = user.id
    user_name = user.name

    # SSE responses live forever; FastAPI's Depends(get_db) would otherwise
    # pin one DB connection per open client. Release it now — the generator
    # below does not touch the DB. Defensively swallow close errors: a failed
    # close shouldn't tear down a successfully authenticated stream.
    try:
        db.close()
    except Exception:  # noqa: BLE001 — best-effort cleanup
        logger.warning("Failed to release DB session before SSE stream", exc_info=True)

    broker = get_broker()

    async def generator() -> AsyncGenerator[str, None]:
        # Subscribe inside the generator so any failure short-circuits before
        # the StreamingResponse starts pumping bytes. `sub` is bound to None
        # so the finally-block can no-op safely if subscribe() itself raised.
        sub = None
        try:
            sub = await broker.subscribe(user_id=user_id, shop_ids=shop_ids)
            # Announce ourselves so peers can render presence immediately.
            yield ":connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event: RealtimeEvent = await asyncio.wait_for(
                        sub.queue.get(),
                        timeout=_HEARTBEAT_SECONDS,
                    )
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    # Heartbeat comment keeps intermediaries from timing us out
                    # and gives the client a way to notice the stream is alive.
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            # Normal: client disconnected, ASGI server is cancelling the task.
            # Re-raise after cleanup so the runtime knows we honoured the cancel.
            raise
        except Exception:  # noqa: BLE001 — log and exit, don't crash the worker
            logger.exception("SSE generator crashed for user %s", user_id)
        finally:
            # GUARANTEED cleanup of the broker subscription. Without this, slow
            # disconnects + repeated reconnects pile up zombie subscribers in
            # the broker's fan-out set and eventually OOM the worker.
            if sub is not None:
                try:
                    await broker.unsubscribe(sub)
                except Exception:  # noqa: BLE001
                    logger.warning("Failed to unsubscribe SSE stream", exc_info=True)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable proxy buffering (Nginx)
            "Connection": "keep-alive",
        },
    )


@router.post("/presence", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def emit_presence(
    entity_type: str = Query(..., regex="^[a-z_]{1,32}$"),
    entity_id: int = Query(..., ge=1),
    phase: str = Query(..., regex="^(viewing|editing|leaving)$"),
    shop_id: int | None = Query(default=None),
    token: str = Query(..., description="Bearer token"),
    db: Session = Depends(get_db),
) -> Response:
    """Emit a presence event. Called by the frontend on route enter / blur /
    unload to let peers see who's looking at what.

    Takes a query-param token for symmetry with the SSE stream — the UI uses
    sendBeacon on leave, and sendBeacon cannot set Authorization headers.
    """
    user = _authenticate_sse_user(token, db)
    resolved_shop_id = shop_id
    if resolved_shop_id is None and user.user_shops:
        # Fall back to the user's first shop assignment — good enough to route
        # presence to other members of the same shop in single-shop setups.
        resolved_shop_id = user.user_shops[0].shop_id
    publish_presence(
        shop_id=resolved_shop_id,
        user_id=user.id,
        user_name=user.name,
        entity_type=entity_type,
        entity_id=entity_id,
        phase=phase,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
