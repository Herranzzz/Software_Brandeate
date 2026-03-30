from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_current_user, get_db, require_shop_manager_user
from app.models import Shop, ShopIntegration, User, UserRole
from app.schemas.integration import (
    ShopIntegrationListResponse,
    ShopifyIntegrationCreate,
    ShopifyImportOrdersResult,
    ShopifySyncOrdersResult,
    ShopIntegrationRead,
)
from app.services.shopify import (
    SHOPIFY_PROVIDER,
    ShopifyCredentialsError,
    ShopifyGraphQLError,
    ShopifyIntegrationNotFoundError,
    ShopifySyncInProgressError,
    ShopifyServiceError,
    resolve_shopify_access_token,
    sync_shopify_shop,
)


router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.post("/shopify", response_model=ShopIntegrationRead, status_code=status.HTTP_201_CREATED)
def create_shopify_integration(
    payload: ShopifyIntegrationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopIntegration:
    shop = db.get(Shop, payload.shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    _ensure_shop_access(payload.shop_id, current_user, accessible_shop_ids)

    db.execute(
        update(ShopIntegration)
        .where(
            ShopIntegration.shop_id == payload.shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
        .values(is_active=False)
    )

    integration = db.scalar(
        select(ShopIntegration).where(
            ShopIntegration.shop_id == payload.shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.shop_domain == payload.shop_domain,
        )
    )

    if integration is None:
        integration = ShopIntegration(
            shop_id=payload.shop_id,
            provider=SHOPIFY_PROVIDER,
            shop_domain=payload.shop_domain,
            access_token=payload.access_token or "",
            client_id=payload.client_id,
            client_secret=payload.client_secret,
            is_active=True,
        )
        db.add(integration)
    else:
        integration.access_token = payload.access_token or ""
        integration.client_id = payload.client_id
        integration.client_secret = payload.client_secret
        integration.is_active = True

    if payload.client_id and payload.client_secret:
        try:
            resolve_shopify_access_token(db, integration)
        except ShopifyCredentialsError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except ShopifyServiceError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    db.commit()
    db.refresh(integration)
    return integration


@router.get("/shopify", response_model=ShopIntegrationListResponse)
def list_shopify_integrations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopIntegrationListResponse:
    query = (
        select(ShopIntegration)
        .where(ShopIntegration.provider == SHOPIFY_PROVIDER, ShopIntegration.is_active.is_(True))
        .order_by(ShopIntegration.created_at.desc(), ShopIntegration.id.desc())
    )
    if accessible_shop_ids is not None:
        query = query.where(ShopIntegration.shop_id.in_(accessible_shop_ids))

    integrations = list(
        db.scalars(
            query
        )
    )
    return ShopIntegrationListResponse(integrations=integrations)


@router.post(
    "/shopify/{shop_id}/import-orders",
    response_model=ShopifyImportOrdersResult,
)
def import_shopify_orders(
    shop_id: int,
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopifyImportOrdersResult:
    _ensure_shop_access(shop_id, current_user, accessible_shop_ids)
    try:
        result = sync_shopify_shop(shop_id, full_sync=True, source="manual_import")
    except ShopifyIntegrationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ShopifyCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ShopifyGraphQLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except ShopifySyncInProgressError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ShopifyServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return ShopifyImportOrdersResult(
        imported_count=result.imported_count,
        updated_count=result.updated_count,
        skipped_count=result.skipped_count,
        customers_created_count=result.customers_created_count,
        customers_updated_count=result.customers_updated_count,
        shipments_created_count=result.shipments_created_count,
        shipments_updated_count=result.shipments_updated_count,
        external_ids_migrated_count=result.external_ids_migrated_count,
        tracking_events_created_count=result.tracking_events_created_count,
        incidents_created_count=result.incidents_created_count,
        total_fetched=result.total_fetched,
    )


@router.post(
    "/shopify/{shop_id}/sync-orders",
    response_model=ShopifySyncOrdersResult,
)
def sync_shopify_orders(
    shop_id: int,
    current_user: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopifySyncOrdersResult:
    _ensure_shop_access(shop_id, current_user, accessible_shop_ids)
    try:
        result = sync_shopify_shop(shop_id, full_sync=False, source="manual_sync")
    except ShopifyIntegrationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ShopifyCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ShopifyGraphQLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except ShopifySyncInProgressError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ShopifyServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return ShopifySyncOrdersResult(
        imported_count=result.imported_count,
        updated_count=result.updated_count,
        customers_created_count=result.customers_created_count,
        customers_updated_count=result.customers_updated_count,
        shipments_created_count=result.shipments_created_count,
        shipments_updated_count=result.shipments_updated_count,
        external_ids_migrated_count=result.external_ids_migrated_count,
        tracking_events_created_count=result.tracking_events_created_count,
        incidents_created_count=result.incidents_created_count,
        total_fetched=result.total_fetched,
    )


def _get_active_shopify_integration(db: Session, shop_id: int) -> ShopIntegration:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    integration = db.scalar(
        select(ShopIntegration).where(
            ShopIntegration.shop_id == shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
    )
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active Shopify integration not found",
        )

    return integration


def _ensure_shop_access(shop_id: int, current_user: User, accessible_shop_ids: set[int] | None) -> None:
    if current_user.role in {UserRole.super_admin, UserRole.ops_admin}:
        return

    if accessible_shop_ids is None or shop_id in accessible_shop_ids:
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
