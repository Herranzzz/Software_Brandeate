from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_shop_manager_user, resolve_shop_scope
from app.models import ShopCatalogProduct, User, UserRole
from app.schemas.catalog import (
    ShopCatalogProductListResponse,
    ShopCatalogProductRead,
    ShopCatalogProductUpdate,
    ShopifyCatalogSyncResult,
)
from app.services.shopify import (
    ShopifyCredentialsError,
    ShopifyGraphQLError,
    ShopifyIntegrationNotFoundError,
    ShopifyServiceError,
    sync_shopify_catalog_for_shop,
)


router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/products", response_model=ShopCatalogProductListResponse)
def list_catalog_products(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopCatalogProductListResponse:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    query = select(ShopCatalogProduct).order_by(ShopCatalogProduct.title.asc(), ShopCatalogProduct.id.asc())

    if scoped_shop_ids is not None:
        query = query.where(ShopCatalogProduct.shop_id.in_(scoped_shop_ids))

    return ShopCatalogProductListResponse(products=list(db.scalars(query)))


@router.post("/shopify/{shop_id}/sync-products", response_model=ShopifyCatalogSyncResult)
def sync_shopify_catalog(
    shop_id: int,
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    db: Session = Depends(get_db),
) -> ShopifyCatalogSyncResult:
    _ensure_shop_access(shop_id, current_user, accessible_shop_ids)
    try:
        result = sync_shopify_catalog_for_shop(db, shop_id)
    except ShopifyIntegrationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ShopifyCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ShopifyGraphQLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except ShopifyServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return ShopifyCatalogSyncResult(
        fetched_count=result.fetched_count,
        created_count=result.created_count,
        updated_count=result.updated_count,
    )


@router.patch("/products/{product_id}", response_model=ShopCatalogProductRead)
def update_catalog_product(
    product_id: int,
    payload: ShopCatalogProductUpdate,
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    db: Session = Depends(get_db),
) -> ShopCatalogProduct:
    product = db.get(ShopCatalogProduct, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog product not found")

    _ensure_shop_access(product.shop_id, current_user, accessible_shop_ids)
    product.is_personalizable = payload.is_personalizable
    db.commit()
    db.refresh(product)
    return product


def _ensure_shop_access(shop_id: int, current_user: User, accessible_shop_ids: set[int] | None) -> None:
    if current_user.role in {UserRole.super_admin, UserRole.ops_admin}:
        return

    if accessible_shop_ids is None or shop_id in accessible_shop_ids:
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
