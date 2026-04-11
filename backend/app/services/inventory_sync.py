"""Inventory sync from Shopify — pulls inventory_quantity per variant into InventoryItems."""

from __future__ import annotations

import json
import logging
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib import error, request

import certifi
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.inventory import InventoryItem, StockMovement
from app.models.shop_integration import ShopIntegration

logger = logging.getLogger(__name__)

SHOPIFY_PROVIDER = "shopify"
SHOPIFY_API_VERSION = "2026-01"
_REST_PAGE_LIMIT = 250


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class InventorySyncResult:
    shop_id: int
    synced: int = 0
    created: int = 0
    skipped: int = 0
    errors: int = 0
    error_details: list[str] = field(default_factory=list)
    sync_status: str = "success"   # "success" | "partial" | "failed"
    synced_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Internal HTTP helpers (mirrors shopify.py pattern)
# ---------------------------------------------------------------------------

def _make_ssl_context() -> ssl.SSLContext:
    settings = get_settings()
    if settings.shopify_ssl_verify:
        cafile = settings.shopify_ssl_cafile or certifi.where()
        return ssl.create_default_context(cafile=cafile)
    return ssl._create_unverified_context()  # noqa: SLF001


def _rest_get(url: str, access_token: str) -> dict:
    """Perform a Shopify REST GET and return the parsed JSON body."""
    ssl_context = _make_ssl_context()
    req = request.Request(
        url,
        method="GET",
        headers={
            "X-Shopify-Access-Token": access_token,
            "Content-Type": "application/json",
        },
    )
    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            with request.urlopen(req, timeout=30, context=ssl_context) as resp:
                body = resp.read().decode("utf-8")
                link_header = resp.getheader("Link") or ""
            return {"body": json.loads(body), "link": link_header}
        except error.HTTPError as exc:
            msg = exc.read().decode("utf-8", errors="ignore")
            if exc.code in {401, 403}:
                raise RuntimeError(f"Shopify credentials rejected (HTTP {exc.code})") from exc
            raise RuntimeError(f"Shopify REST error HTTP {exc.code}: {msg}") from exc
        except (error.URLError, ssl.SSLError) as exc:
            last_exc = exc
            if attempt == 3:
                raise RuntimeError(f"Could not connect to Shopify: {exc}") from exc
            logger.warning(
                "Retrying Shopify REST GET attempt=%s url=%s reason=%s",
                attempt,
                url,
                exc,
            )
            time.sleep(0.6 * attempt)
    raise RuntimeError(f"Could not connect to Shopify: {last_exc}")


def _iter_products(shop_domain: str, access_token: str):
    """Yield all Shopify products (paginated) with id and variants fields."""
    url = (
        f"https://{shop_domain}/admin/api/{SHOPIFY_API_VERSION}/products.json"
        f"?limit={_REST_PAGE_LIMIT}&fields=id,variants"
    )
    while url:
        result = _rest_get(url, access_token)
        products = result["body"].get("products", [])
        yield from products
        # Follow pagination via Link header
        url = _parse_next_link(result["link"])


def _parse_next_link(link_header: str) -> str | None:
    """Extract next-page URL from a Shopify Link header, or None."""
    if not link_header:
        return None
    for part in link_header.split(","):
        part = part.strip()
        if 'rel="next"' in part:
            # Format: <https://...>; rel="next"
            url_part = part.split(";")[0].strip()
            if url_part.startswith("<") and url_part.endswith(">"):
                return url_part[1:-1]
    return None


# ---------------------------------------------------------------------------
# Core sync logic for a single integration
# ---------------------------------------------------------------------------

def _sync_one_integration(integration: ShopIntegration, db: Session) -> InventorySyncResult:
    shop_id = integration.shop_id
    result = InventorySyncResult(shop_id=shop_id)
    now = datetime.now(timezone.utc)

    access_token = (integration.access_token or "").strip()
    shop_domain = (integration.shop_domain or "").strip()

    if not access_token or not shop_domain:
        result.sync_status = "failed"
        result.errors += 1
        result.error_details.append(f"shop_id={shop_id}: missing shop_domain or access_token")
        _update_integration_status(integration, result, db)
        return result

    try:
        for product in _iter_products(shop_domain, access_token):
            for variant in product.get("variants", []):
                sku = (variant.get("sku") or "").strip()
                if not sku:
                    result.skipped += 1
                    continue

                shopify_qty = variant.get("inventory_quantity")
                if shopify_qty is None:
                    result.skipped += 1
                    continue

                shopify_qty = int(shopify_qty)

                # Look up the matching InventoryItem
                item = db.scalar(
                    select(InventoryItem).where(
                        InventoryItem.shop_id == shop_id,
                        InventoryItem.sku == sku,
                    )
                )

                if item is None:
                    # Create new item with Shopify quantity
                    item = InventoryItem(
                        shop_id=shop_id,
                        sku=sku,
                        name=sku,  # minimal name; catalog sync can enrich later
                        stock_on_hand=shopify_qty,
                    )
                    db.add(item)
                    db.flush()

                    if shopify_qty != 0:
                        movement = StockMovement(
                            shop_id=shop_id,
                            inventory_item_id=item.id,
                            sku=sku,
                            movement_type="cycle_count",
                            qty_delta=shopify_qty,
                            qty_before=0,
                            qty_after=shopify_qty,
                            notes="Shopify inventory sync — initial import",
                        )
                        db.add(movement)

                    result.created += 1
                    continue

                # Item exists — compute delta
                qty_before = item.stock_on_hand
                qty_delta = shopify_qty - qty_before

                if qty_delta == 0:
                    result.skipped += 1
                    continue

                # Apply cycle_count movement
                movement = StockMovement(
                    shop_id=shop_id,
                    inventory_item_id=item.id,
                    sku=sku,
                    movement_type="cycle_count",
                    qty_delta=qty_delta,
                    qty_before=qty_before,
                    qty_after=shopify_qty,
                    notes="Shopify inventory sync",
                )
                db.add(movement)

                item.stock_on_hand = shopify_qty
                item.updated_at = now

                result.synced += 1

    except Exception as exc:
        logger.exception(
            "Error syncing inventory from Shopify for shop_id=%s: %s",
            shop_id,
            exc,
        )
        result.errors += 1
        result.error_details.append(str(exc))
        result.sync_status = "failed" if result.synced == 0 and result.created == 0 else "partial"
        db.rollback()
        _update_integration_status(integration, result, db)
        return result

    try:
        db.commit()
    except Exception as exc:
        logger.exception("DB commit failed for shop_id=%s inventory sync: %s", shop_id, exc)
        result.errors += 1
        result.error_details.append(f"DB commit error: {exc}")
        result.sync_status = "failed"
        db.rollback()
        _update_integration_status(integration, result, db)
        return result

    if result.errors > 0:
        result.sync_status = "partial"
    else:
        result.sync_status = "success"

    _update_integration_status(integration, result, db)
    return result


def _update_integration_status(
    integration: ShopIntegration, result: InventorySyncResult, db: Session
) -> None:
    integration.last_synced_at = result.synced_at
    integration.last_sync_status = result.sync_status
    integration.last_sync_summary = {
        "synced": result.synced,
        "created": result.created,
        "skipped": result.skipped,
        "errors": result.errors,
    }
    integration.last_error_message = (
        "; ".join(result.error_details[:3]) if result.error_details else None
    )
    try:
        db.commit()
    except Exception as exc:
        logger.warning("Could not update integration status for shop_id=%s: %s", integration.shop_id, exc)
        db.rollback()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def sync_inventory_from_shopify(
    shop_id: int | None = None,
    db: Session | None = None,
) -> list[InventorySyncResult]:
    """Sync Shopify inventory quantities into InventoryItem.stock_on_hand.

    If shop_id is given, only that shop is synced.
    Otherwise all active Shopify integrations are synced.

    Returns a list of InventorySyncResult (one per integration).
    """
    own_session = db is None
    if own_session:
        db = SessionLocal()

    try:
        query = select(ShopIntegration).where(
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
        if shop_id is not None:
            query = query.where(ShopIntegration.shop_id == shop_id)

        integrations = db.scalars(query).all()

        if not integrations:
            logger.warning(
                "No active Shopify integrations found for shop_id=%s", shop_id
            )
            return []

        results: list[InventorySyncResult] = []
        for integration in integrations:
            result = _sync_one_integration(integration, db)
            results.append(result)
            logger.info(
                "Inventory sync for shop_id=%s: synced=%s created=%s skipped=%s errors=%s status=%s",
                integration.shop_id,
                result.synced,
                result.created,
                result.skipped,
                result.errors,
                result.sync_status,
            )

        return results

    finally:
        if own_session:
            db.close()
