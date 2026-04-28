"""In-process pub/sub broker for realtime SSE fan-out.

Scope: one Python process. If you scale beyond a single worker, swap the
broker for a Redis / NATS backend — only `publish()` and
`subscribe()` need to change, callers are untouched.

Why in-memory first: zero new dependencies, zero infra to operate, enough for
the current deployment. The interface is designed so the swap is trivial.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Per-subscriber buffer. If a client is slow we drop oldest events rather than
# blocking the publisher — better to lose a tick than stall every other
# subscriber behind one laggy tab.
_SUBSCRIBER_QUEUE_SIZE = 64


@dataclass(frozen=True)
class RealtimeEvent:
    """A single fan-out payload."""
    type: str                 # "activity", "presence", "ping"
    shop_id: int | None       # None = global (super-admin broadcasts)
    payload: dict[str, Any]
    id: str = field(default_factory=lambda: f"{int(time.time() * 1000)}")

    def to_sse(self) -> str:
        """Format as a Server-Sent Events frame."""
        data = json.dumps(self.payload, default=str, ensure_ascii=False)
        return f"id: {self.id}\nevent: {self.type}\ndata: {data}\n\n"


@dataclass(eq=False)
class _Subscriber:
    queue: asyncio.Queue[RealtimeEvent]
    shop_ids: frozenset[int] | None  # None = admin sees all
    user_id: int


class RealtimeBroker:
    def __init__(self) -> None:
        self._subscribers: set[_Subscriber] = set()
        self._lock = asyncio.Lock()

    async def subscribe(
        self,
        *,
        user_id: int,
        shop_ids: frozenset[int] | None,
    ) -> _Subscriber:
        sub = _Subscriber(
            queue=asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE_SIZE),
            shop_ids=shop_ids,
            user_id=user_id,
        )
        async with self._lock:
            self._subscribers.add(sub)
        return sub

    async def unsubscribe(self, sub: _Subscriber) -> None:
        async with self._lock:
            self._subscribers.discard(sub)

    def publish_nowait(self, event: RealtimeEvent) -> None:
        """Fan-out without awaiting. Safe to call from sync code paths."""
        # Copy to avoid mutation during iteration; the set is small.
        for sub in list(self._subscribers):
            if sub.shop_ids is not None and event.shop_id is not None:
                if event.shop_id not in sub.shop_ids:
                    continue
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the oldest, try again. If the client is this slow, they
                # were going to miss events anyway.
                try:
                    sub.queue.get_nowait()
                    sub.queue.put_nowait(event)
                except Exception:
                    logger.debug("Dropped event for subscriber user_id=%s", sub.user_id)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


_broker = RealtimeBroker()


def get_broker() -> RealtimeBroker:
    return _broker


def publish_activity(
    *,
    shop_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int,
    summary: str,
    actor_id: int | None,
    actor_name: str | None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Broadcast an activity event to every connected subscriber that is
    allowed to see it (shop-scoped). Called from `log_activity()`.
    """
    _broker.publish_nowait(
        RealtimeEvent(
            type="activity",
            shop_id=shop_id,
            payload={
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "summary": summary,
                "actor_id": actor_id,
                "actor_name": actor_name,
                "shop_id": shop_id,
                "detail": detail or {},
                "created_at": time.time(),
            },
        )
    )


def publish_job_progress(
    *,
    job_id: str,
    job_kind: str,
    user_id: int | None,
    shop_id: int | None,
    status: str,
    progress_done: int,
    progress_total: int,
    detail: dict[str, Any] | None = None,
) -> None:
    """Broadcast progress for a long-running background job (bulk design,
    shopify sync, etc). Subscribers filter by job_id; the user_id field lets
    the UI scope progress to the operator that started the job.
    """
    _broker.publish_nowait(
        RealtimeEvent(
            type="job_progress",
            shop_id=shop_id,
            payload={
                "job_id": job_id,
                "job_kind": job_kind,
                "user_id": user_id,
                "status": status,
                "progress_done": progress_done,
                "progress_total": progress_total,
                "detail": detail or {},
                "at": time.time(),
            },
        )
    )


def publish_presence(
    *,
    shop_id: int | None,
    user_id: int,
    user_name: str | None,
    entity_type: str,
    entity_id: int,
    phase: str,  # "viewing" | "editing" | "leaving"
) -> None:
    _broker.publish_nowait(
        RealtimeEvent(
            type="presence",
            shop_id=shop_id,
            payload={
                "user_id": user_id,
                "user_name": user_name,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "phase": phase,
                "at": time.time(),
            },
        )
    )
