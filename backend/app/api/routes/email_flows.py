from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db, require_shop_manager_user
from app.models import User
from app.models.email_flow import EmailFlow, EmailFlowLog
from app.schemas.email_flow import EmailFlowLogRead, EmailFlowRead, EmailFlowUpdate
from app.services.email_flows import get_or_create_flows

router = APIRouter(prefix="/email-flows", tags=["email-flows"])


@router.get("", response_model=list[EmailFlowRead])
def list_email_flows(
    shop_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[EmailFlow]:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    return get_or_create_flows(db, shop_id)


@router.patch("/{flow_id}", response_model=EmailFlowRead)
def update_email_flow(
    flow_id: int,
    payload: EmailFlowUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> EmailFlow:
    flow = db.get(EmailFlow, flow_id)
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email flow not found")
    if accessible_shop_ids is not None and flow.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(flow, field, value)
    db.commit()
    db.refresh(flow)
    return flow


@router.get("/logs", response_model=list[EmailFlowLogRead])
def list_email_flow_logs(
    shop_id: int,
    flow_type: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[EmailFlowLog]:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    q = select(EmailFlowLog).where(EmailFlowLog.shop_id == shop_id)
    if flow_type:
        q = q.where(EmailFlowLog.flow_type == flow_type)
    q = q.order_by(EmailFlowLog.sent_at.desc()).limit(min(limit, 200))
    return list(db.scalars(q))
