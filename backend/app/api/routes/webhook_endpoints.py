from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_user, require_shop_manager_user
from app.models.user import User, UserRole
from app.models.webhook_endpoint import WebhookEndpoint
from app.schemas.webhook_endpoint import (
    WebhookEndpointCreate,
    WebhookEndpointRead,
    WebhookEndpointUpdate,
)
from app.services.webhooks import send_test_webhook


router = APIRouter(prefix="/webhook-endpoints", tags=["webhook-endpoints"])


def _get_accessible_shop_ids(current_user: User) -> set[int] | None:
    """Return None for admins (unrestricted), or a set of shop_ids for shop_admin."""
    if current_user.role in {UserRole.super_admin, UserRole.ops_admin}:
        return None
    return {assignment.shop_id for assignment in current_user.user_shops}


def _assert_shop_access(current_user: User, shop_id: int) -> None:
    accessible = _get_accessible_shop_ids(current_user)
    if accessible is not None and shop_id not in accessible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")


@router.get("", response_model=list[WebhookEndpointRead])
def list_webhook_endpoints(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
):
    query = select(WebhookEndpoint).order_by(WebhookEndpoint.created_at.desc())
    accessible = _get_accessible_shop_ids(current_user)

    if accessible is not None:
        # shop_admin: scope to their shops only
        if shop_id is not None:
            if shop_id not in accessible:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
            query = query.where(WebhookEndpoint.shop_id == shop_id)
        else:
            query = query.where(WebhookEndpoint.shop_id.in_(accessible))
    else:
        if shop_id is not None:
            query = query.where(WebhookEndpoint.shop_id == shop_id)

    return list(db.scalars(query))


@router.post("", response_model=WebhookEndpointRead, status_code=status.HTTP_201_CREATED)
def create_webhook_endpoint(
    body: WebhookEndpointCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
):
    _assert_shop_access(current_user, body.shop_id)

    ep = WebhookEndpoint(
        shop_id=body.shop_id,
        url=body.url,
        secret=body.secret,
        events=body.events,
        is_active=body.is_active,
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return ep


@router.patch("/{endpoint_id}", response_model=WebhookEndpointRead)
def update_webhook_endpoint(
    endpoint_id: int,
    body: WebhookEndpointUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
):
    ep = db.get(WebhookEndpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    _assert_shop_access(current_user, ep.shop_id)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(ep, field, value)

    db.commit()
    db.refresh(ep)
    return ep


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook_endpoint(
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
):
    ep = db.get(WebhookEndpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    _assert_shop_access(current_user, ep.shop_id)

    db.delete(ep)
    db.commit()


@router.post("/{endpoint_id}/test")
def test_webhook_endpoint(
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
):
    ep = db.get(WebhookEndpoint, endpoint_id)
    if ep is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    _assert_shop_access(current_user, ep.shop_id)

    return send_test_webhook(ep)
