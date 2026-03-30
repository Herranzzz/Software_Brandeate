from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db, require_admin_user
from app.core.config import get_settings
from app.models import Shop, User, UserRole, UserShop
from app.schemas.auth import UserAdminRead, UserCreate, UserListResponse, UserRead, UserShopsResponse
from app.services.auth import decode_access_token, hash_password


router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UserListResponse)
def list_users(
    role: UserRole | None = Query(default=None),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserListResponse:
    query = (
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .order_by(User.created_at.desc(), User.id.desc())
    )
    if role is not None:
        query = query.where(User.role == role)

    users = list(db.scalars(query))
    payload = [
        UserAdminRead.model_validate(
            {
                **UserRead.model_validate(user).model_dump(),
                "shops": [assignment.shop for assignment in user.user_shops if assignment.shop is not None],
            }
        )
        for user in users
    ]
    return UserListResponse(users=payload)


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
        is_active=True,
    )
    user.user_shops = [UserShop(shop_id=shop.id) for shop in shops]

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


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
