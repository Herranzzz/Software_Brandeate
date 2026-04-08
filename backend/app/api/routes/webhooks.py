import base64
import hashlib
import hmac

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import ShopIntegration
from app.services.shopify import SHOPIFY_PROVIDER, ShopifySyncInProgressError, sync_shopify_shop


router = APIRouter(prefix="/webhooks/shopify", tags=["webhooks"])


@router.post("/orders/create", status_code=status.HTTP_202_ACCEPTED)
async def shopify_order_create_webhook(
    request: Request,
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
):
    return await _handle_shopify_webhook(
        request=request,
        topic="orders/create",
        hmac_header=x_shopify_hmac_sha256,
        shop_domain_header=x_shopify_shop_domain,
    )


@router.post("/orders/updated", status_code=status.HTTP_202_ACCEPTED)
async def shopify_order_updated_webhook(
    request: Request,
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
):
    return await _handle_shopify_webhook(
        request=request,
        topic="orders/updated",
        hmac_header=x_shopify_hmac_sha256,
        shop_domain_header=x_shopify_shop_domain,
    )


@router.post("/orders/cancelled", status_code=status.HTTP_202_ACCEPTED)
async def shopify_order_cancelled_webhook(
    request: Request,
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
):
    return await _handle_shopify_webhook(
        request=request,
        topic="orders/cancelled",
        hmac_header=x_shopify_hmac_sha256,
        shop_domain_header=x_shopify_shop_domain,
    )


@router.post("/fulfillments/create", status_code=status.HTTP_202_ACCEPTED)
async def shopify_fulfillment_create_webhook(
    request: Request,
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
):
    return await _handle_shopify_webhook(
        request=request,
        topic="fulfillments/create",
        hmac_header=x_shopify_hmac_sha256,
        shop_domain_header=x_shopify_shop_domain,
    )


@router.post("/fulfillments/update", status_code=status.HTTP_202_ACCEPTED)
async def shopify_fulfillment_update_webhook(
    request: Request,
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
):
    return await _handle_shopify_webhook(
        request=request,
        topic="fulfillments/update",
        hmac_header=x_shopify_hmac_sha256,
        shop_domain_header=x_shopify_shop_domain,
    )


async def _handle_shopify_webhook(
    *,
    request: Request,
    topic: str,
    hmac_header: str | None,
    shop_domain_header: str | None,
) -> dict:
    payload = await request.body()
    _validate_shopify_hmac(payload, hmac_header)

    if not shop_domain_header:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Shopify shop domain header")

    shop_domain = _normalize_shop_domain(shop_domain_header)
    shop_id = _find_shop_id_by_domain(shop_domain)
    if shop_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shopify integration not found")

    if not get_settings().shopify_webhook_immediate_sync_enabled:
        return {
            "ok": True,
            "scheduled": False,
            "topic": topic,
            "detail": "Immediate webhook sync disabled; background scheduler will process changes.",
        }

    try:
        sync_shopify_shop(shop_id, full_sync=False, source=f"webhook:{topic}")
    except ShopifySyncInProgressError:
        return {"ok": True, "scheduled": False, "detail": "Sync already in progress"}

    return {"ok": True, "scheduled": True, "topic": topic}


def _validate_shopify_hmac(payload: bytes, provided_hmac: str | None) -> None:
    secret = get_settings().shopify_webhook_secret
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Shopify webhook secret not configured")
    if not provided_hmac:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Shopify webhook signature")

    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    expected_hmac = base64.b64encode(digest).decode("utf-8")
    if not hmac.compare_digest(expected_hmac, provided_hmac):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Shopify webhook signature")


def _find_shop_id_by_domain(shop_domain: str) -> int | None:
    with SessionLocal() as db:
        integration = db.scalar(
            select(ShopIntegration).where(
                ShopIntegration.provider == SHOPIFY_PROVIDER,
                ShopIntegration.shop_domain == shop_domain,
                ShopIntegration.is_active.is_(True),
            )
        )
        return integration.shop_id if integration else None


def _normalize_shop_domain(value: str) -> str:
    normalized = value.strip().lower()
    normalized = normalized.removeprefix("https://").removeprefix("http://")
    return normalized.rstrip("/")
