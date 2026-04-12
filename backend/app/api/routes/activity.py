from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.activity import ActivityLogRead

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityLogRead])
def get_activity(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    limit: int = Query(50, ge=1, le=200),
    _user: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    """Return activity timeline for a specific entity."""
    rows = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.entity_type == entity_type, ActivityLog.entity_id == entity_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    ).all()
    return rows


@router.get("/recent", response_model=list[ActivityLogRead])
def get_recent_activity(
    limit: int = Query(20, ge=1, le=100),
    _user: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    """Return most recent activity across all entities (admin only)."""
    rows = db.scalars(
        select(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    ).all()
    return rows


@router.get("/notifications")
def get_notifications(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Recent activity log entries as notifications for the current user."""
    query = (
        select(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    if accessible_shop_ids is not None:
        query = query.where(ActivityLog.shop_id.in_(accessible_shop_ids))
    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "actor_name": log.actor_name,
        }
        for log in db.scalars(query)
    ]
