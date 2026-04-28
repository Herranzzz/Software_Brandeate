from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user
from app.models import Order
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.activity import ActivityLogRead, CommentEditRequest
from app.services.activity import log_activity

router = APIRouter(prefix="/activity", tags=["activity"])


# Entity types that accept user-authored comments. Keep this narrow — every
# entry in this set needs a matching shop-scope check below so we don't leak
# comments across tenants.
_COMMENTABLE_ENTITY_TYPES = frozenset({"order"})


class CommentCreateRequest(BaseModel):
    entity_type: str
    entity_id: int
    body: str = Field(min_length=1, max_length=2000)


@router.get("", response_model=list[ActivityLogRead])
def get_activity(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    db: Session = Depends(get_db),
):
    """Return activity timeline for a specific entity. Admins see everything;
    shop members only see entities belonging to shops they're assigned to.
    """
    if entity_type == "order" and accessible_shop_ids is not None:
        order_shop_id = db.scalar(select(Order.shop_id).where(Order.id == entity_id))
        if order_shop_id is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        if order_shop_id not in accessible_shop_ids:
            raise HTTPException(status_code=403, detail="Sin acceso a este pedido")

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


@router.post("/comment", response_model=ActivityLogRead, status_code=status.HTTP_201_CREATED)
def create_comment(
    payload: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Post a comment on an entity. Stored as an ActivityLog row with
    action="comment_added" so it appears in the existing timeline and fires
    the realtime feed automatically.
    """
    if payload.entity_type not in _COMMENTABLE_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de entidad no soporta comentarios")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="El comentario está vacío")

    shop_id: int | None = None
    if payload.entity_type == "order":
        order = db.scalar(select(Order).where(Order.id == payload.entity_id))
        if order is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
            raise HTTPException(status_code=403, detail="Sin acceso a este pedido")
        shop_id = order.shop_id

    entry = log_activity(
        db,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        shop_id=shop_id,
        action="comment_added",
        actor=current_user,
        summary=body,
        detail={"body": body, "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)},
    )
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/comment/{comment_id}", response_model=ActivityLogRead)
def edit_comment(
    comment_id: int,
    payload: CommentEditRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Edit the body of a comment. Only the original author can edit."""
    entry = db.get(ActivityLog, comment_id)
    if entry is None or entry.is_deleted or entry.action != "comment_added":
        raise HTTPException(status_code=404, detail="Comentario no encontrado")
    if entry.actor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Solo el autor puede editar el comentario")
    if accessible_shop_ids is not None and entry.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=403, detail="Sin acceso")

    body = payload.body.strip()
    entry.summary = body
    entry.edited_at = datetime.now(timezone.utc)
    if entry.detail_json:
        entry.detail_json = {**entry.detail_json, "body": body}
    else:
        entry.detail_json = {"body": body}
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/comment/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    """Soft-delete a comment. Only the author or an admin can delete."""
    entry = db.get(ActivityLog, comment_id)
    if entry is None or entry.is_deleted or entry.action != "comment_added":
        raise HTTPException(status_code=404, detail="Comentario no encontrado")
    is_admin = current_user.role.value == "admin" if hasattr(current_user.role, "value") else str(current_user.role) == "admin"
    if entry.actor_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Sin permiso para borrar este comentario")
    if accessible_shop_ids is not None and entry.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=403, detail="Sin acceso")

    entry.is_deleted = True
    db.commit()


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
