from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.models import User, UserRole, UserShop
from app.db.session import SessionLocal
from app.services.auth import decode_access_token


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token, get_settings().auth_secret)
    user = db.scalar(
        select(User)
        .options(selectinload(User.user_shops).selectinload(UserShop.shop))
        .where(User.id == payload["sub"])
    )
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


def require_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in {UserRole.super_admin, UserRole.ops_admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_shop_manager_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in {UserRole.super_admin, UserRole.ops_admin, UserRole.shop_admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop manager access required")
    return current_user


def get_accessible_shop_ids(current_user: User = Depends(get_current_user)) -> set[int] | None:
    if current_user.role in {UserRole.super_admin, UserRole.ops_admin}:
        return None

    return {assignment.shop_id for assignment in current_user.user_shops}


def resolve_shop_scope(
    requested_shop_id: int | None,
    accessible_shop_ids: set[int] | None,
) -> set[int] | None:
    if accessible_shop_ids is None:
        return {requested_shop_id} if requested_shop_id is not None else None

    if requested_shop_id is not None:
        if requested_shop_id not in accessible_shop_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
        return {requested_shop_id}

    return set(accessible_shop_ids)
