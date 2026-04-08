from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db, require_admin_user
from app.core.config import get_settings
from app.models import Order, Shipment, Shop, User, UserRole, UserShop
from app.schemas.auth import (
    UserAdminRead,
    UserCreate,
    UserListResponse,
    UserRead,
    UserShopsResponse,
    UserUpdate,
)
from app.schemas.employee import (
    EmployeeActivityItem,
    EmployeeActivityResponse,
    EmployeeAnalyticsResponse,
    EmployeeAnalyticsRow,
    EmployeeMetricsPeriod,
)
from app.services.auth import decode_access_token, hash_password


router = APIRouter(prefix="/users", tags=["users"])
BUSINESS_TIMEZONE = ZoneInfo("Europe/Madrid")


def _serialize_user(user: User) -> UserAdminRead:
    return UserAdminRead.model_validate(
        {
            **UserRead.model_validate(user).model_dump(),
            "shops": [assignment.shop for assignment in user.user_shops if assignment.shop is not None],
        }
    )


def _resolve_activity_windows() -> tuple[datetime, datetime]:
    now_local = datetime.now(BUSINESS_TIMEZONE)
    start_of_today_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week_local = start_of_today_local - timedelta(days=start_of_today_local.weekday())
    return start_of_today_local.astimezone(timezone.utc), start_of_week_local.astimezone(timezone.utc)


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
    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user.role != UserRole.super_admin and user.role == UserRole.super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can manage super admins")

    if current_user.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes borrar tu propia cuenta")

    shipment_count = db.scalar(
        select(func.count(Shipment.id)).where(Shipment.created_by_employee_id == user.id)
    )
    if shipment_count and shipment_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este empleado ya tiene etiquetas o envíos creados. Desactiva la cuenta para conservar la trazabilidad.",
        )

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
