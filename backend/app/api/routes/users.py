from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_admin_user
from app.core.config import get_settings
from app.models import DesignStatus, Incident, IncidentStatus, IncidentType, Order, OrderItem, OrderStatus, ProductionStatus, Shipment, Shop, User, UserRole, UserShop
from app.schemas.auth import (
    ClientAccountCreate,
    ClientAccountUpdate,
    UserAdminRead,
    UserCreate,
    UserListResponse,
    UserRead,
    UserSelfUpdate,
    UserShopsResponse,
    UserUpdate,
)
from app.schemas.employee import (
    EmployeeActivityItem,
    EmployeeActivityResponse,
    EmployeeAnalyticsResponse,
    EmployeeAnalyticsRow,
    EmployeeMetricsPeriod,
    EmployeeWorkspaceMetrics,
    EmployeeWorkspaceRecentItem,
    EmployeeWorkspaceResponse,
)
from app.services.auth import decode_access_token, hash_password


router = APIRouter(prefix="/users", tags=["users"])
BUSINESS_TIMEZONE = ZoneInfo("Europe/Madrid")
CLIENT_ACCOUNT_ROLES = {UserRole.shop_admin, UserRole.shop_viewer}
PORTAL_ACCOUNT_MANAGER_ROLES = {UserRole.super_admin, UserRole.ops_admin, UserRole.shop_admin}


def _serialize_user(user: User, *, allowed_shop_ids: set[int] | None = None) -> UserAdminRead:
    return UserAdminRead.model_validate(
        {
            **UserRead.model_validate(user).model_dump(),
            "shops": [
                assignment.shop
                for assignment in user.user_shops
                if assignment.shop is not None and (allowed_shop_ids is None or assignment.shop_id in allowed_shop_ids)
            ],
        }
    )


def _load_user_with_shops(db: Session, user_id: int) -> User | None:
    return db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user_id)
    )


def _user_shop_ids(user: User) -> set[int]:
    return {assignment.shop_id for assignment in user.user_shops}


def _resolve_client_account_role(role: str) -> UserRole:
    resolved = UserRole(role)
    if resolved not in CLIENT_ACCOUNT_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rol no permitido para cuenta cliente")
    return resolved


def _require_portal_account_manager(current_user: User) -> None:
    if current_user.role not in PORTAL_ACCOUNT_MANAGER_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permisos para gestionar cuentas cliente")


def _resolve_shop_assignments_for_scope(
    db: Session,
    *,
    shop_ids: list[int],
    accessible_shop_ids: set[int] | None,
) -> tuple[list[Shop], set[int]]:
    requested_shop_ids = {int(shop_id) for shop_id in shop_ids if int(shop_id) > 0}
    if not requested_shop_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecciona al menos una tienda")

    if accessible_shop_ids is not None and not requested_shop_ids.issubset(accessible_shop_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No puedes asignar tiendas fuera de tu alcance")

    shops = list(db.scalars(select(Shop).where(Shop.id.in_(requested_shop_ids))))
    if len(shops) != len(requested_shop_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more shops not found")
    return shops, requested_shop_ids


def _load_client_accounts_for_scope(db: Session, *, accessible_shop_ids: set[int] | None) -> list[User]:
    query = (
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.role.in_(tuple(CLIENT_ACCOUNT_ROLES)))
        .order_by(User.is_active.desc(), User.created_at.desc(), User.id.desc())
    )
    if accessible_shop_ids is not None:
        query = query.join(User.user_shops).where(UserShop.shop_id.in_(accessible_shop_ids)).distinct()

    users = list(db.scalars(query))
    if accessible_shop_ids is None:
        return users

    return [user for user in users if _user_shop_ids(user).issubset(accessible_shop_ids)]


def _ensure_manageable_client_account(
    user: User,
    *,
    accessible_shop_ids: set[int] | None,
) -> set[int]:
    if user.role not in CLIENT_ACCOUNT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo puedes gestionar cuentas cliente")

    target_shop_ids = _user_shop_ids(user)
    if accessible_shop_ids is not None and not target_shop_ids.issubset(accessible_shop_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No puedes gestionar una cuenta fuera de tus tiendas")
    return target_shop_ids


def _ensure_shop_admin_coverage(
    db: Session,
    *,
    shop_ids: set[int],
    excluded_user_id: int | None = None,
) -> None:
    if not shop_ids:
        return

    coverage_query = (
        select(UserShop.shop_id, func.count(User.id))
        .join(User, User.id == UserShop.user_id)
        .where(
            UserShop.shop_id.in_(shop_ids),
            User.role == UserRole.shop_admin,
            User.is_active.is_(True),
        )
        .group_by(UserShop.shop_id)
    )
    if excluded_user_id is not None:
        coverage_query = coverage_query.where(User.id != excluded_user_id)

    coverage = {
        int(shop_id): int(count or 0)
        for shop_id, count in db.execute(coverage_query).all()
    }
    missing = sorted(shop_id for shop_id in shop_ids if coverage.get(shop_id, 0) == 0)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cada tienda debe mantener al menos un shop_admin activo.",
        )


def _ensure_user_has_no_activity(db: Session, user: User) -> None:
    shipment_count = db.scalar(
        select(func.count(Shipment.id)).where(Shipment.created_by_employee_id == user.id)
    )
    order_activity_count = db.scalar(
        select(func.count(Order.id)).where(
            or_(
                Order.prepared_by_employee_id == user.id,
                Order.last_touched_by_employee_id == user.id,
            )
        )
    )
    incident_activity_count = db.scalar(
        select(func.count(Incident.id)).where(Incident.last_touched_by_employee_id == user.id)
    )
    if (shipment_count and shipment_count > 0) or (order_activity_count and order_activity_count > 0) or (
        incident_activity_count and incident_activity_count > 0
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este empleado ya tiene actividad registrada. Desactiva la cuenta para conservar la trazabilidad.",
        )


def _resolve_activity_windows() -> tuple[datetime, datetime]:
    now_local = datetime.now(BUSINESS_TIMEZONE)
    start_of_today_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week_local = start_of_today_local - timedelta(days=start_of_today_local.weekday())
    return start_of_today_local.astimezone(timezone.utc), start_of_week_local.astimezone(timezone.utc)


def _prepared_clause():
    return or_(
        Order.production_status.in_([ProductionStatus.packed, ProductionStatus.completed]),
        Order.status == OrderStatus.ready_to_ship,
    )


def _workspace_order_href(user: User, order_id: int) -> str:
    base = "/orders" if user.role in {UserRole.super_admin, UserRole.ops_admin} else "/portal/orders"
    return f"{base}/{order_id}"


def _workspace_incidents_href(user: User) -> str:
    return "/incidencias" if user.role in {UserRole.super_admin, UserRole.ops_admin} else "/portal/incidencias"


def _load_users(
    db: Session,
    *,
    role: UserRole | None = None,
) -> list[User]:
    query = (
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .order_by(User.is_active.desc(), User.created_at.desc(), User.id.desc())
    )
    if role is not None:
        query = query.where(User.role == role)
    return list(db.scalars(query))


def _build_employee_analytics(
    db: Session,
    *,
    period: EmployeeMetricsPeriod,
    role: UserRole | None = None,
    shop_id: int | None = None,
) -> list[EmployeeAnalyticsRow]:
    users = _load_users(db, role=role)
    if not users:
        return []

    user_ids = [user.id for user in users]
    start_of_today, start_of_week = _resolve_activity_windows()
    activity_at = func.coalesce(Shipment.label_created_at, Shipment.created_at)
    metrics_query = (
        select(
            Shipment.created_by_employee_id.label("employee_id"),
            func.count(Shipment.id).label("total_labels"),
            func.sum(case((activity_at >= start_of_today, 1), else_=0)).label("labels_today"),
            func.sum(case((activity_at >= start_of_week, 1), else_=0)).label("labels_this_week"),
            func.max(activity_at).label("last_activity_at"),
        )
        .join(Shipment.order)
        .where(Shipment.created_by_employee_id.in_(user_ids))
        .group_by(Shipment.created_by_employee_id)
    )
    if shop_id is not None:
        metrics_query = metrics_query.where(Order.shop_id == shop_id)

    metrics_rows = {
        int(row.employee_id): row
        for row in db.execute(metrics_query).all()
        if row.employee_id is not None
    }

    def sort_key(item: EmployeeAnalyticsRow) -> tuple[int, int, int, str]:
        period_count = item.labels_today if period == "day" else item.labels_this_week
        return (period_count, item.total_labels, int(item.is_active), item.name.lower())

    payload = [
        EmployeeAnalyticsRow.model_validate(
            {
                **UserRead.model_validate(user).model_dump(),
                "shops": [assignment.shop for assignment in user.user_shops if assignment.shop is not None],
                "labels_today": int((metrics_rows.get(user.id).labels_today if metrics_rows.get(user.id) else 0) or 0),
                "labels_this_week": int((metrics_rows.get(user.id).labels_this_week if metrics_rows.get(user.id) else 0) or 0),
                "total_labels": int((metrics_rows.get(user.id).total_labels if metrics_rows.get(user.id) else 0) or 0),
                "last_activity_at": metrics_rows.get(user.id).last_activity_at if metrics_rows.get(user.id) else None,
            }
        )
        for user in users
    ]
    return sorted(payload, key=sort_key, reverse=True)


def _build_employee_workspace(
    db: Session,
    *,
    user: User,
    accessible_shop_ids: set[int] | None,
) -> EmployeeWorkspaceResponse:
    start_of_today, start_of_week = _resolve_activity_windows()
    shipment_activity_at = func.coalesce(Shipment.label_created_at, Shipment.created_at)
    visible_shop_filter = Order.shop_id.in_(accessible_shop_ids) if accessible_shop_ids is not None else None

    shipments_metrics_query = (
        select(
            func.count(Shipment.id).label("total_labels"),
            func.sum(case((shipment_activity_at >= start_of_today, 1), else_=0)).label("labels_today"),
            func.sum(case((shipment_activity_at >= start_of_week, 1), else_=0)).label("labels_this_week"),
            func.max(shipment_activity_at).label("last_activity_at"),
        )
        .join(Shipment.order)
        .where(Shipment.created_by_employee_id == user.id)
    )
    if visible_shop_filter is not None:
        shipments_metrics_query = shipments_metrics_query.where(visible_shop_filter)
    shipment_metrics = db.execute(shipments_metrics_query).one()

    prepared_metrics_query = (
        select(
            func.count(Order.id).label("orders_prepared_total"),
            func.sum(case((Order.prepared_at >= start_of_today, 1), else_=0)).label("orders_prepared_today"),
            func.max(Order.prepared_at).label("last_prepared_at"),
        )
        .where(Order.prepared_by_employee_id == user.id)
    )
    if visible_shop_filter is not None:
        prepared_metrics_query = prepared_metrics_query.where(visible_shop_filter)
    prepared_metrics = db.execute(prepared_metrics_query).one()

    pending_orders_query = select(func.count(Order.id)).where(~_prepared_clause())
    if visible_shop_filter is not None:
        pending_orders_query = pending_orders_query.where(visible_shop_filter)
    pending_orders_visible = int(db.scalar(pending_orders_query) or 0)

    incidents_open_query = (
        select(func.count(Incident.id))
        .join(Incident.order)
        .where(Incident.status != IncidentStatus.resolved)
    )
    if visible_shop_filter is not None:
        incidents_open_query = incidents_open_query.where(visible_shop_filter)
    incidents_visible = int(db.scalar(incidents_open_query) or 0)

    assignee_tokens = {user.email.strip().lower(), user.name.strip().lower()}
    incidents_assigned_query = (
        select(func.count(Incident.id))
        .join(Incident.order)
        .where(
            Incident.status != IncidentStatus.resolved,
            func.lower(func.coalesce(Incident.assignee, "")).in_(assignee_tokens),
        )
    )
    if visible_shop_filter is not None:
        incidents_assigned_query = incidents_assigned_query.where(visible_shop_filter)
    incidents_assigned = int(db.scalar(incidents_assigned_query) or 0)

    stalled_shipments_query = (
        select(func.count(func.distinct(Incident.order_id)))
        .join(Incident.order)
        .where(
            Incident.status != IncidentStatus.resolved,
            Incident.type == IncidentType.shipping_exception,
        )
    )
    if visible_shop_filter is not None:
        stalled_shipments_query = stalled_shipments_query.where(visible_shop_filter)
    stalled_shipments_visible = int(db.scalar(stalled_shipments_query) or 0)

    designs_ready_query = (
        select(func.count(func.distinct(Order.id)))
        .join(Order.items)
        .where(
            OrderItem.design_status == DesignStatus.design_available,
            ~_prepared_clause(),
        )
    )
    if visible_shop_filter is not None:
        designs_ready_query = designs_ready_query.where(visible_shop_filter)
    designs_ready_visible = int(db.scalar(designs_ready_query) or 0)

    recent_orders_handled_query = select(func.count(func.distinct(Order.id))).where(
        or_(
            Order.prepared_by_employee_id == user.id,
            Order.last_touched_by_employee_id == user.id,
        ),
        or_(
            Order.prepared_at >= start_of_week,
            Order.last_touched_at >= start_of_week,
        ),
    )
    if visible_shop_filter is not None:
        recent_orders_handled_query = recent_orders_handled_query.where(visible_shop_filter)
    recent_orders_handled = int(db.scalar(recent_orders_handled_query) or 0)

    recent_shipments_query = (
        select(
            Shipment.order_id.label("order_id"),
            Order.external_id.label("order_external_id"),
            Shipment.tracking_number.label("tracking_number"),
            shipment_activity_at.label("activity_at"),
        )
        .join(Shipment.order)
        .where(Shipment.created_by_employee_id == user.id)
        .order_by(shipment_activity_at.desc(), Shipment.id.desc())
        .limit(6)
    )
    if visible_shop_filter is not None:
        recent_shipments_query = recent_shipments_query.where(visible_shop_filter)

    recent_orders_query = (
        select(
            Order.id.label("order_id"),
            Order.external_id.label("order_external_id"),
            Order.customer_name.label("customer_name"),
            Order.prepared_at.label("activity_at"),
        )
        .where(
            Order.prepared_by_employee_id == user.id,
            Order.prepared_at.is_not(None),
        )
        .order_by(Order.prepared_at.desc(), Order.id.desc())
        .limit(6)
    )
    if visible_shop_filter is not None:
        recent_orders_query = recent_orders_query.where(visible_shop_filter)

    recent_incidents_query = (
        select(
            Incident.id.label("incident_id"),
            Incident.title.label("title"),
            Order.id.label("order_id"),
            Order.external_id.label("order_external_id"),
            func.coalesce(Incident.last_touched_at, Incident.updated_at).label("activity_at"),
        )
        .join(Incident.order)
        .where(Incident.last_touched_by_employee_id == user.id)
        .order_by(func.coalesce(Incident.last_touched_at, Incident.updated_at).desc(), Incident.id.desc())
        .limit(6)
    )
    if visible_shop_filter is not None:
        recent_incidents_query = recent_incidents_query.where(visible_shop_filter)

    activity_items: list[EmployeeWorkspaceRecentItem] = []
    for row in db.execute(recent_shipments_query).all():
        activity_items.append(
            EmployeeWorkspaceRecentItem(
                type="label",
                title=f"Etiqueta creada · {row.order_external_id}",
                subtitle=row.tracking_number or "Tracking pendiente",
                href=_workspace_order_href(user, row.order_id),
                timestamp=row.activity_at,
                badge="Etiqueta",
            )
        )
    for row in db.execute(recent_orders_query).all():
        activity_items.append(
            EmployeeWorkspaceRecentItem(
                type="order_prepared",
                title=f"Pedido preparado · {row.order_external_id}",
                subtitle=row.customer_name or "Pedido listo para expedición",
                href=_workspace_order_href(user, row.order_id),
                timestamp=row.activity_at,
                badge="Preparado",
            )
        )
    for row in db.execute(recent_incidents_query).all():
        activity_items.append(
            EmployeeWorkspaceRecentItem(
                type="incident",
                title=row.title or f"Incidencia · {row.order_external_id}",
                subtitle=f"Pedido {row.order_external_id}",
                href=_workspace_incidents_href(user),
                timestamp=row.activity_at,
                badge="Incidencia",
            )
        )

    recent_activity = sorted(activity_items, key=lambda item: item.timestamp, reverse=True)[:8]
    last_activity_candidates = [
        value
        for value in [
            shipment_metrics.last_activity_at,
            prepared_metrics.last_prepared_at,
            recent_activity[0].timestamp if recent_activity else None,
        ]
        if value is not None
    ]
    last_activity_at = max(last_activity_candidates) if last_activity_candidates else None

    return EmployeeWorkspaceResponse(
        employee_id=user.id,
        employee_name=user.name,
        employee_email=user.email,
        role=user.role,
        shop_ids=[assignment.shop_id for assignment in user.user_shops],
        metrics=EmployeeWorkspaceMetrics(
            labels_today=int(shipment_metrics.labels_today or 0),
            labels_this_week=int(shipment_metrics.labels_this_week or 0),
            total_labels=int(shipment_metrics.total_labels or 0),
            orders_prepared_today=int(prepared_metrics.orders_prepared_today or 0),
            orders_prepared_total=int(prepared_metrics.orders_prepared_total or 0),
            pending_orders_visible=pending_orders_visible,
            incidents_visible=incidents_visible,
            incidents_assigned=incidents_assigned,
            stalled_shipments_visible=stalled_shipments_visible,
            designs_ready_visible=designs_ready_visible,
            recent_orders_handled=recent_orders_handled,
            last_activity_at=last_activity_at,
        ),
        recent_activity=recent_activity,
        generated_at=datetime.now(timezone.utc),
    )


@router.get("", response_model=UserListResponse)
def list_users(
    role: UserRole | None = Query(default=None),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserListResponse:
    return UserListResponse(users=[_serialize_user(user) for user in _load_users(db, role=role)])


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    users_exist = db.scalar(select(User.id).limit(1)) is not None
    current_user: User | None = None

    if users_exist:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        token = authorization.split(" ", 1)[1].strip()
        payload_data = decode_access_token(token, get_settings().auth_secret)
        current_user = db.get(User, payload_data["sub"])
        if current_user is None or not current_user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        if current_user.role not in {UserRole.super_admin, UserRole.ops_admin}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    elif payload.role not in {UserRole.super_admin, UserRole.ops_admin}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The first user must be an admin user",
        )

    existing_user = db.scalar(select(User).where(User.email == payload.email))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    shops = []
    if payload.shop_ids:
        shops = list(db.scalars(select(Shop).where(Shop.id.in_(payload.shop_ids))))
        if len(shops) != len(set(payload.shop_ids)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more shops not found")

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    user.user_shops = [UserShop(shop_id=shop.id) for shop in shops]

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/employee-analytics", response_model=EmployeeAnalyticsResponse)
def get_employee_analytics(
    period: EmployeeMetricsPeriod = Query(default="week"),
    role: UserRole | None = Query(default=None),
    shop_id: int | None = Query(default=None, ge=1),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> EmployeeAnalyticsResponse:
    return EmployeeAnalyticsResponse(
        period=period,
        employees=_build_employee_analytics(db, period=period, role=role, shop_id=shop_id),
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/me/workspace", response_model=EmployeeWorkspaceResponse)
def get_my_workspace(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> EmployeeWorkspaceResponse:
    return _build_employee_workspace(db, user=current_user, accessible_shop_ids=accessible_shop_ids)


@router.get("/me/shops", response_model=UserShopsResponse)
def get_my_shops(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserShopsResponse:
    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == current_user.id)
    )
    shops = [assignment.shop for assignment in user.user_shops]
    return UserShopsResponse(shops=shops)


@router.get("/me", response_model=UserAdminRead)
def get_my_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserAdminRead:
    user = _load_user_with_shops(db, current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _serialize_user(user)


@router.patch("/me/account", response_model=UserAdminRead)
def update_my_account(
    payload: UserSelfUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserAdminRead:
    user = _load_user_with_shops(db, current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if payload.email and payload.email != user.email:
        existing_user = db.scalar(select(User).where(User.email == payload.email, User.id != user.id))
        if existing_user is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        user.email = payload.email

    if payload.name is not None:
        user.name = payload.name
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)

    db.add(user)
    db.commit()
    reloaded = _load_user_with_shops(db, user.id)
    assert reloaded is not None
    return _serialize_user(reloaded)


@router.get("/me/client-accounts", response_model=UserListResponse)
def list_my_client_accounts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> UserListResponse:
    _require_portal_account_manager(current_user)
    users = _load_client_accounts_for_scope(db, accessible_shop_ids=accessible_shop_ids)
    allowed_shop_ids = accessible_shop_ids if current_user.role == UserRole.shop_admin else None
    return UserListResponse(users=[_serialize_user(user, allowed_shop_ids=allowed_shop_ids) for user in users])


@router.post("/me/client-accounts", response_model=UserAdminRead, status_code=status.HTTP_201_CREATED)
def create_my_client_account(
    payload: ClientAccountCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> UserAdminRead:
    _require_portal_account_manager(current_user)

    existing_user = db.scalar(select(User).where(User.email == payload.email))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    shops, _ = _resolve_shop_assignments_for_scope(
        db,
        shop_ids=payload.shop_ids,
        accessible_shop_ids=accessible_shop_ids,
    )
    role = _resolve_client_account_role(payload.role)

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=role,
        is_active=payload.is_active,
    )
    user.user_shops = [UserShop(shop_id=shop.id) for shop in shops]

    db.add(user)
    db.commit()
    reloaded = _load_user_with_shops(db, user.id)
    assert reloaded is not None
    allowed_shop_ids = accessible_shop_ids if current_user.role == UserRole.shop_admin else None
    return _serialize_user(reloaded, allowed_shop_ids=allowed_shop_ids)


@router.patch("/me/client-accounts/{user_id}", response_model=UserAdminRead)
def update_my_client_account(
    user_id: int,
    payload: ClientAccountUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> UserAdminRead:
    _require_portal_account_manager(current_user)

    user = _load_user_with_shops(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    current_shop_ids = _ensure_manageable_client_account(user, accessible_shop_ids=accessible_shop_ids)
    requested_role = _resolve_client_account_role(payload.role) if payload.role is not None else user.role
    requested_is_active = payload.is_active if payload.is_active is not None else user.is_active

    if current_user.id == user.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes desactivar tu propia cuenta")

    if payload.email and payload.email != user.email:
        existing_user = db.scalar(select(User).where(User.email == payload.email, User.id != user.id))
        if existing_user is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        user.email = payload.email

    requested_shop_ids = set(current_shop_ids)
    replacement_shops: list[Shop] | None = None
    if payload.shop_ids is not None:
        replacement_shops, requested_shop_ids = _resolve_shop_assignments_for_scope(
            db,
            shop_ids=payload.shop_ids,
            accessible_shop_ids=accessible_shop_ids,
        )

    affected_shops_for_coverage: set[int] = set()
    if user.role == UserRole.shop_admin and user.is_active:
        if requested_role != UserRole.shop_admin or not requested_is_active:
            affected_shops_for_coverage = set(current_shop_ids)
        elif payload.shop_ids is not None:
            affected_shops_for_coverage = current_shop_ids - requested_shop_ids
    _ensure_shop_admin_coverage(
        db,
        shop_ids=affected_shops_for_coverage,
        excluded_user_id=user.id,
    )

    if payload.name is not None:
        user.name = payload.name
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = requested_role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if replacement_shops is not None:
        user.user_shops = [UserShop(shop_id=shop.id) for shop in replacement_shops]

    db.add(user)
    db.commit()
    reloaded = _load_user_with_shops(db, user.id)
    assert reloaded is not None
    allowed_shop_ids = accessible_shop_ids if current_user.role == UserRole.shop_admin else None
    return _serialize_user(reloaded, allowed_shop_ids=allowed_shop_ids)


@router.delete("/me/client-accounts/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_client_account(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Response:
    _require_portal_account_manager(current_user)

    user = _load_user_with_shops(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_user.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes borrar tu propia cuenta")

    target_shop_ids = _ensure_manageable_client_account(user, accessible_shop_ids=accessible_shop_ids)
    if user.role == UserRole.shop_admin and user.is_active:
        _ensure_shop_admin_coverage(
            db,
            shop_ids=target_shop_ids,
            excluded_user_id=user.id,
        )
    _ensure_user_has_no_activity(db, user)

    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{user_id}", response_model=UserAdminRead)
def get_user_detail(
    user_id: int,
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserAdminRead:
    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _serialize_user(user)


@router.patch("/{user_id}", response_model=UserAdminRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserAdminRead:
    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    requested_role = payload.role or user.role
    if current_user.role != UserRole.super_admin and (
        user.role == UserRole.super_admin or requested_role == UserRole.super_admin
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can manage super admins")

    if current_user.id == user.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes desactivar tu propia cuenta")

    if current_user.id == user.id and requested_role not in {UserRole.super_admin, UserRole.ops_admin}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tu cuenta debe mantener acceso admin")

    if payload.email and payload.email != user.email:
        existing_user = db.scalar(select(User).where(User.email == payload.email, User.id != user.id))
        if existing_user is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        user.email = payload.email

    if payload.name is not None:
        user.name = payload.name
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    if payload.shop_ids is not None:
        if requested_role in {UserRole.super_admin, UserRole.ops_admin}:
            user.user_shops = []
        else:
            shops = list(db.scalars(select(Shop).where(Shop.id.in_(payload.shop_ids))))
            if len(shops) != len(set(payload.shop_ids)):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more shops not found")
            user.user_shops = [UserShop(shop_id=shop.id) for shop in shops]
    elif requested_role in {UserRole.super_admin, UserRole.ops_admin}:
        user.user_shops = []

    db.add(user)
    db.commit()
    db.refresh(user)
    reloaded = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user.id)
    )
    assert reloaded is not None
    return _serialize_user(reloaded)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> Response:
    user = _load_user_with_shops(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user.role != UserRole.super_admin and user.role == UserRole.super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can manage super admins")

    if current_user.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes borrar tu propia cuenta")

    _ensure_user_has_no_activity(db, user)

    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{user_id}/activity", response_model=EmployeeActivityResponse)
def get_user_activity(
    user_id: int,
    limit: int = Query(default=12, ge=1, le=50),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> EmployeeActivityResponse:
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    activity_at = func.coalesce(Shipment.label_created_at, Shipment.created_at)
    rows = db.execute(
        select(
            Shipment.id.label("shipment_id"),
            Shipment.order_id.label("order_id"),
            Shipment.carrier.label("carrier"),
            Shipment.tracking_number.label("tracking_number"),
            Shipment.label_created_at.label("label_created_at"),
            Shipment.created_at.label("created_at"),
            Order.external_id.label("order_external_id"),
            activity_at.label("last_activity_at"),
        )
        .join(Shipment.order)
        .where(Shipment.created_by_employee_id == user_id)
        .order_by(activity_at.desc(), Shipment.id.desc())
        .limit(limit)
    ).all()

    return EmployeeActivityResponse(
        employee_id=user.id,
        employee_name=user.name,
        items=[
            EmployeeActivityItem(
                shipment_id=row.shipment_id,
                order_id=row.order_id,
                order_external_id=row.order_external_id,
                carrier=row.carrier,
                tracking_number=row.tracking_number,
                label_created_at=row.label_created_at,
                created_at=row.created_at,
                last_activity_at=row.last_activity_at,
            )
            for row in rows
        ],
    )
