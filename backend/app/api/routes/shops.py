from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db, require_admin_user, require_shop_manager_user
from app.models import Shop, User, UserRole
from app.schemas.shop import ShopCreate, ShopRead, ShopUpdate


router = APIRouter(prefix="/shops", tags=["shops"])


@router.post("", response_model=ShopRead, status_code=status.HTTP_201_CREATED)
def create_shop(
    payload: ShopCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_user),
) -> Shop:
    existing_shop = db.scalar(select(Shop).where(Shop.slug == payload.slug))
    if existing_shop is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")

    shop = Shop(name=payload.name, slug=payload.slug)
    db.add(shop)
    db.commit()
    db.refresh(shop)
    return shop


@router.get("", response_model=list[ShopRead])
def list_shops(
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Shop]:
    query = select(Shop).order_by(Shop.created_at.desc(), Shop.id.desc())
    if accessible_shop_ids is not None:
        query = query.where(Shop.id.in_(accessible_shop_ids))
    return list(db.scalars(query))


@router.get("/{shop_id}", response_model=ShopRead)
def get_shop(
    shop_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    if accessible_shop_ids is not None and shop.id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    return shop


@router.patch("/{shop_id}", response_model=ShopRead)
def update_shop(
    shop_id: int,
    payload: ShopUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    if current_user.role not in {UserRole.super_admin, UserRole.ops_admin}:
        if accessible_shop_ids is not None and shop.id not in accessible_shop_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    if payload.slug is not None:
        slug_owner = db.scalar(select(Shop).where(Shop.slug == payload.slug, Shop.id != shop_id))
        if slug_owner is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")

    if payload.name is not None:
        shop.name = payload.name.strip()
    if payload.slug is not None:
        shop.slug = payload.slug
    if payload.shipping_settings is not None:
        shop.shipping_settings_json = payload.shipping_settings.model_dump(mode="json")

    db.commit()
    db.refresh(shop)
    return shop


@router.patch("/{shop_id}/tracking-config", response_model=ShopRead)
def update_tracking_config(
    shop_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    if current_user.role not in {UserRole.super_admin, UserRole.ops_admin}:
        if accessible_shop_ids is not None and shop.id not in accessible_shop_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    shop.tracking_config_json = body
    db.commit()
    db.refresh(shop)
    return shop
