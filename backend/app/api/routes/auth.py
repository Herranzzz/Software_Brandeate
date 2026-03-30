from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.models import Shop, User, UserRole, UserShop
from app.schemas.auth import LoginRequest, LoginResponse, MeResponse, TenantRegistrationRequest
from app.services.auth import create_access_token, hash_password, verify_password


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(user, get_settings().auth_secret)
    return LoginResponse(access_token=token, user=user)


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

    token = create_access_token(user, get_settings().auth_secret)
    return LoginResponse(access_token=token, user=user)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(user=current_user)
