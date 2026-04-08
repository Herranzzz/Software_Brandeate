from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, resolve_shop_scope
from app.models import Incident, IncidentPriority, IncidentStatus, IncidentType, Order, User
from app.schemas.incident import IncidentCreate, IncidentRead, IncidentUpdate


router = APIRouter(prefix="/incidents", tags=["incidents"])


def _incident_query():
    return select(Incident).options(joinedload(Incident.order))


@router.post("", response_model=IncidentRead, status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Incident:
    order = db.get(Order, payload.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    incident = Incident(
        **payload.model_dump(),
        last_touched_by_employee_id=current_user.id,
        last_touched_at=datetime.now(timezone.utc),
    )
    db.add(incident)
    db.commit()
    return db.scalar(_incident_query().where(Incident.id == incident.id))


@router.get("", response_model=list[IncidentRead])
def list_incidents(
    status: IncidentStatus | None = None,
    priority: IncidentPriority | None = None,
    type: IncidentType | None = None,
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Incident]:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    query = _incident_query().order_by(Incident.updated_at.desc(), Incident.id.desc())

    if status is not None:
        query = query.where(Incident.status == status)
    if priority is not None:
        query = query.where(Incident.priority == priority)
    if type is not None:
        query = query.where(Incident.type == type)
    if scoped_shop_ids is not None:
        query = query.join(Incident.order).where(Order.shop_id.in_(scoped_shop_ids))

    return list(db.scalars(query))


@router.get("/{incident_id}", response_model=IncidentRead)
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Incident:
    incident = db.scalar(_incident_query().where(Incident.id == incident_id))
    if incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    if accessible_shop_ids is not None and incident.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    return incident


@router.patch("/{incident_id}", response_model=IncidentRead)
def update_incident(
    incident_id: int,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> Incident:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    if accessible_shop_ids is not None and incident.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

    incident.last_touched_by_employee_id = current_user.id
    incident.last_touched_at = datetime.now(timezone.utc)
    incident.updated_at = datetime.now(timezone.utc)
    db.commit()
    return db.scalar(_incident_query().where(Incident.id == incident_id))
