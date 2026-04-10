from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.models import Shop, User, UserRole, UserShop
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    RefreshRequest,
    RefreshResponse,
    TenantRegistrationRequest,
)
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])


def _login_response(user: User, secret: str) -> LoginResponse:
    return LoginResponse(
        access_token=create_access_token(user, secret),
        refresh_token=create_refresh_token(user, secret),
        user=user,
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return _login_response(user, get_settings().auth_secret)


@router.post("/refresh", response_model=RefreshResponse)
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)) -> RefreshResponse:
    """Emite un nuevo access token a partir de un refresh token válido."""
    secret = get_settings().auth_secret
    try:
        token_data = decode_refresh_token(payload.refresh_token, secret)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = db.scalar(select(User).where(User.id == token_data["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return RefreshResponse(
        access_token=create_access_token(user, secret),
        refresh_token=create_refresh_token(user, secret),
    )


@router.post("/register-tenant", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register_tenant(payload: TenantRegistrationRequest, db: Session = Depends(get_db)) -> LoginResponse:
    existing_user = db.scalar(select(User).where(User.email == payload.owner_email))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    existing_shop = db.scalar(select(Shop).where(Shop.slug == payload.shop_slug))
    if existing_shop is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shop slug already exists")

    shop = Shop(name=payload.shop_name.strip(), slug=payload.shop_slug)
    user = User(
        name=payload.owner_name.strip(),
        email=payload.owner_email,
        password_hash=hash_password(payload.password),
        role=UserRole.shop_admin,
        is_active=True,
    )

    db.add(shop)
    db.flush()
    user.user_shops = [UserShop(shop_id=shop.id)]
    db.add(user)
    db.commit()
    db.refresh(user)

    return _login_response(user, get_settings().auth_secret)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(user=current_user)


@router.post("/impersonate/{user_id}", response_model=LoginResponse)
def impersonate_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoginResponse:
    if current_user.role not in {UserRole.super_admin, UserRole.ops_admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    target_user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == user_id)
    )
    if target_user is None or not target_user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target_user.role not in {UserRole.shop_admin, UserRole.shop_viewer}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo puedes impersonar cuentas cliente (shop_admin/shop_viewer).",
        )

    return _login_response(target_user, get_settings().auth_secret)
