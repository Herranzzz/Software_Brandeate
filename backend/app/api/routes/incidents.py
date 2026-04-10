from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, load_only, selectinload

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user, resolve_shop_scope
from app.core.config import get_settings
from app.models import Incident, IncidentPriority, IncidentStatus, IncidentType, Order, Shipment, User
from app.schemas.incident import IncidentCreate, IncidentRead, IncidentUpdate
from app.services.automation_rules import evaluate_order_automation_rules, reconcile_incident_lifecycle


router = APIRouter(prefix="/incidents", tags=["incidents"])

DEFAULT_INCIDENTS_PER_PAGE = 200
MAX_INCIDENTS_PER_PAGE = 500


def _incident_query():
    return select(Incident).options(
        joinedload(Incident.order).load_only(
            Order.id,
            Order.shop_id,
            Order.external_id,
            Order.is_personalized,
            Order.customer_name,
            Order.customer_email,
        )
    )


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
    response: Response,
    status: IncidentStatus | None = None,
    priority: IncidentPriority | None = None,
    type: IncidentType | None = None,
    shop_id: int | None = None,
    recent_days: int | None = None,
    include_historical: bool = False,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=DEFAULT_INCIDENTS_PER_PAGE, ge=1, le=MAX_INCIDENTS_PER_PAGE),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Incident]:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    lifecycle = reconcile_incident_lifecycle(db=db, scoped_shop_ids=scoped_shop_ids)
    if lifecycle["resolved_total"] > 0:
        db.commit()

    settings = get_settings()
    effective_recent_days = None if include_historical else recent_days
    if effective_recent_days is None and not include_historical:
        effective_recent_days = max(int(settings.incidents_operational_window_days or 30), 1)

    query = _incident_query().order_by(Incident.updated_at.desc(), Incident.id.desc())
    count_query = select(func.count()).select_from(Incident)

    if status is not None:
        query = query.where(Incident.status == status)
        count_query = count_query.where(Incident.status == status)
    if priority is not None:
        query = query.where(Incident.priority == priority)
        count_query = count_query.where(Incident.priority == priority)
    if type is not None:
        query = query.where(Incident.type == type)
        count_query = count_query.where(Incident.type == type)
    if effective_recent_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(int(effective_recent_days), 1))
        query = query.where(Incident.updated_at >= cutoff)
        count_query = count_query.where(Incident.updated_at >= cutoff)
    if scoped_shop_ids is not None:
        query = query.join(Incident.order).where(Order.shop_id.in_(scoped_shop_ids))
        count_query = count_query.where(Incident.order.has(Order.shop_id.in_(scoped_shop_ids)))

    total_count = int(db.scalar(count_query) or 0)
    response.headers["X-Total-Count"] = str(total_count)
    safe_per_page = max(1, min(per_page, MAX_INCIDENTS_PER_PAGE))
    safe_page = max(page, 1)
    query = query.limit(safe_per_page).offset((safe_page - 1) * safe_per_page)

    return list(db.scalars(query))


@router.post("/reconcile", status_code=status.HTTP_200_OK)
def reconcile_automated_incidents(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _admin_user: User = Depends(require_admin_user),
) -> dict:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    count_base_query = select(func.count()).select_from(Incident).where(Incident.status != IncidentStatus.resolved)
    automated_count_base_query = (
        select(func.count())
        .select_from(Incident)
        .where(Incident.status != IncidentStatus.resolved, Incident.is_automated.is_(True))
    )
    if scoped_shop_ids is not None:
        count_base_query = count_base_query.where(Incident.order.has(Order.shop_id.in_(scoped_shop_ids)))
        automated_count_base_query = automated_count_base_query.where(Incident.order.has(Order.shop_id.in_(scoped_shop_ids)))

    open_before = int(db.scalar(count_base_query) or 0)
    automated_open_before = int(db.scalar(automated_count_base_query) or 0)

    lifecycle = reconcile_incident_lifecycle(db=db, scoped_shop_ids=scoped_shop_ids)

    query = (
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.shipment).selectinload(Shipment.events),
            selectinload(Order.incidents),
        )
        .join(Order.incidents)
        .where(
            Incident.status != IncidentStatus.resolved,
        )
        .order_by(Order.id.asc())
        .distinct()
    )
    if scoped_shop_ids is not None:
        query = query.where(Order.shop_id.in_(scoped_shop_ids))

    orders = list(db.scalars(query))
    for order in orders:
        evaluate_order_automation_rules(db=db, order=order, source="incident_reconcile")
    db.commit()

    open_after = int(db.scalar(count_base_query) or 0)
    automated_open_after = int(db.scalar(automated_count_base_query) or 0)
    return {
        "orders_rechecked": len(orders),
        "open_before": open_before,
        "open_after": open_after,
        "resolved_total": max(open_before - open_after, 0),
        "automated_open_before": automated_open_before,
        "automated_open_after": automated_open_after,
        "automated_resolved": max(automated_open_before - automated_open_after, 0),
        "lifecycle_resolved_terminal_orders": lifecycle["resolved_terminal_orders"],
        "lifecycle_resolved_stale": lifecycle["resolved_stale"],
        "lifecycle_resolved_total": lifecycle["resolved_total"],
    }


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
