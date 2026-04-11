from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import User


def log_activity(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    shop_id: int | None = None,
    action: str,
    actor: User | None = None,
    summary: str,
    detail: dict[str, Any] | None = None,
) -> ActivityLog:
    """Create an activity log entry and flush it to the session."""
    entry = ActivityLog(
        entity_type=entity_type,
        entity_id=entity_id,
        shop_id=shop_id,
        action=action,
        actor_id=actor.id if actor else None,
        actor_name=actor.name if actor else None,
        summary=summary,
        detail_json=detail,
    )
    db.add(entry)
    db.flush()
    return entry
