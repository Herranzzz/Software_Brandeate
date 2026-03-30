from __future__ import annotations

import json
import logging
import ssl
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib import error, request

import certifi
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session, selectinload

from app.models import (
    Incident,
    IncidentPriority,
    IncidentStatus,
    IncidentType,
    Order,
    OrderItem,
    OrderStatus,
    ProductionStatus,
    Shipment,
    ShopCustomer,
    ShopCatalogProduct,
    ShopCatalogVariant,
    ShopIntegration,
    ShopSyncEvent,
    TrackingEvent,
)
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.orders import infer_design_status, infer_order_is_personalized, sync_order_status_from_tracking


SHOPIFY_PROVIDER = "shopify"
SHOPIFY_API_VERSION = "2026-01"
logger = logging.getLogger(__name__)


def _truncate_sync_error(message: str | None, max_length: int = 900) -> str | None:
    if not message:
        return None
    normalized = str(message).strip()
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 1]}…"

RECENT_ORDERS_QUERY = """
query RecentOrders($first: Int!, $query: String, $after: String) {
  orders(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        sourceName
        cancelledAt
        createdAt
        note
        tags
        customAttributes {
          key
          value
        }
        customer {
          id
          firstName
          lastName
          email
          phone
        }
        fulfillments(first: 10) {
          id
          name
          displayStatus
          inTransitAt
          deliveredAt
          updatedAt
          trackingInfo {
            company
            number
            url
          }
        }
        fulfillmentOrders(first: 10) {
          nodes {
            id
            status
            requestStatus
            assignedLocation {
              location {
                id
                name
              }
            }
            fulfillments(first: 10) {
              nodes {
                id
                status
                trackingInfo(first: 10) {
                  company
                  number
                  url
                }
              }
            }
            lineItems(first: 20) {
              nodes {
                lineItem {
                  id
                  title
                }
              }
            }
          }
        }
        lineItems(first: 20) {
          nodes {
            id
            name
            title
            variantTitle
            sku
            quantity
            customAttributes {
              key
              value
            }
            variant {
              id
              title
              sku
              product {
                id
                title
              }
            }
          }
        }
      }
    }
  }
}
"""

ORDER_LINK_BACKFILL_QUERY = """
query OrderLinkBackfill($first: Int!, $query: String!) {
  orders(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query) {
    edges {
      node {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        sourceName
        cancelledAt
        createdAt
        note
        tags
        customAttributes {
          key
          value
        }
        customer {
          id
          firstName
          lastName
          email
          phone
        }
        fulfillments(first: 10) {
          id
          name
          displayStatus
          inTransitAt
          deliveredAt
          updatedAt
          trackingInfo {
            company
            number
            url
          }
        }
        fulfillmentOrders(first: 10) {
          nodes {
            id
            status
            requestStatus
            assignedLocation {
              location {
                id
                name
              }
            }
            fulfillments(first: 10) {
              nodes {
                id
                status
                trackingInfo(first: 10) {
                  company
                  number
                  url
                }
              }
            }
            lineItems(first: 20) {
              nodes {
                lineItem {
                  id
                  title
                }
              }
            }
          }
        }
        lineItems(first: 50) {
          nodes {
            id
            name
            title
            variantTitle
            sku
            quantity
            customAttributes {
              key
              value
            }
            variant {
              id
              title
              sku
              product {
                id
                title
              }
            }
          }
        }
      }
    }
  }
}
"""

CUSTOMERS_QUERY = """
query Customers($first: Int!, $query: String, $after: String) {
  customers(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        firstName
        lastName
        email
        phone
        tags
        numberOfOrders
        updatedAt
        defaultAddress {
          address1
          address2
          city
          company
          country
          countryCodeV2
          province
          provinceCode
          zip
          phone
          name
        }
      }
    }
  }
}
"""

PRODUCT_CATALOG_QUERY = """
query ProductCatalog($first: Int!, $query: String, $after: String) {
  products(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        title
        handle
        vendor
        productType
        status
        createdAt
        updatedAt
        featuredImage {
          url
        }
        variants(first: 20) {
          nodes {
            id
            title
            sku
            createdAt
            updatedAt
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
}
"""


TRACKING_STATUS_MAP = {
    "LABEL_PURCHASED": "label_created",
    "LABEL_PRINTED": "label_created",
    "CONFIRMED": "label_created",
    "CARRIER_PICKED_UP": "in_transit",
    "IN_TRANSIT": "in_transit",
    "OUT_FOR_DELIVERY": "out_for_delivery",
    "READY_FOR_PICKUP": "pickup_available",
    "DELIVERED": "delivered",
    "FAILURE": "exception",
    "DELAYED": "exception",
}


@dataclass
class ShopifyLineItem:
    id: str | None
    title: str
    sku: str
    quantity: int
    product_id: str | None
    variant_id: str | None
    variant_title: str | None
    custom_attributes: dict[str, str]
    customization_id: str | None
    design_link: str | None
    customization_provider: str | None
    personalization_notes: str | None
    personalization_assets: list[dict]
    personalization_details: dict[str, str]


@dataclass
class ShopifyFulfillmentEvent:
    status: str
    happened_at: str


@dataclass
class ShopifyFulfillment:
    id: str | None
    name: str | None
    display_status: str | None
    in_transit_at: str | None
    delivered_at: str | None
    updated_at: str | None
    tracking_company: str | None
    tracking_number: str | None
    tracking_url: str | None
    events: list[ShopifyFulfillmentEvent]


@dataclass
class ShopifyOrder:
    id: str
    name: str
    source_name: str | None
    display_financial_status: str | None
    display_fulfillment_status: str | None
    cancelled_at: str | None
    created_at: str
    note: str | None
    tags: list[str]
    customer_id: str | None
    customer_first_name: str | None
    customer_last_name: str | None
    customer_email: str | None
    customer_phone: str | None
    custom_attributes: dict[str, str]
    fulfillment_orders: list[dict]
    tracking_company: str | None
    tracking_number: str | None
    tracking_url: str | None
    latest_tracking_status: str | None
    latest_tracking_occurred_at: str | None
    fulfillments: list[ShopifyFulfillment]
    line_items: list[ShopifyLineItem]


@dataclass
class ShopifyImportResult:
    imported_count: int
    updated_count: int
    skipped_count: int
    customers_created_count: int
    customers_updated_count: int
    shipments_created_count: int
    shipments_updated_count: int
    external_ids_migrated_count: int
    tracking_events_created_count: int
    incidents_created_count: int
    total_fetched: int


@dataclass
class ShopifyCatalogVariantPayload:
    external_variant_id: str
    title: str | None
    sku: str | None
    option_values: list[dict]
    created_at: datetime | None
    updated_at: datetime | None


@dataclass
class ShopifyCatalogProductPayload:
    external_product_id: str
    title: str
    handle: str | None
    vendor: str | None
    product_type: str | None
    status: str | None
    image_url: str | None
    variants: list[ShopifyCatalogVariantPayload]
    created_at: datetime | None
    updated_at: datetime | None


@dataclass
class ShopifyCatalogSyncResult:
    fetched_count: int
    created_count: int
    updated_count: int


@dataclass
class ShipmentSyncResult:
    shipment_created: bool = False
    shipment_updated: bool = False
    tracking_events_created_count: int = 0


class ShopifyServiceError(Exception):
    pass


@dataclass
class ShopifyCustomerPayload:
    external_customer_id: str
    first_name: str | None
    last_name: str | None
    name: str | None
    email: str | None
    phone: str | None
    tags: list[str]
    number_of_orders: int | None
    default_address: dict | None
    last_order_at: datetime | None


class ShopifyCredentialsError(ShopifyServiceError):
    pass


class ShopifyGraphQLError(ShopifyServiceError):
    pass


class ShopifySyncInProgressError(ShopifyServiceError):
    pass


class ShopifyIntegrationNotFoundError(ShopifyServiceError):
    pass


_sync_lock = threading.Lock()
_running_shop_syncs: set[int] = set()


def map_shopify_status_to_internal_order_status(shopify_order: ShopifyOrder) -> OrderStatus:
    if shopify_order.cancelled_at:
        return OrderStatus.exception

    fulfillment_status = (shopify_order.display_fulfillment_status or "").upper()

    if fulfillment_status == "UNFULFILLED":
        return OrderStatus.pending
    if fulfillment_status == "IN_PROGRESS":
        return OrderStatus.in_progress
    if fulfillment_status in {"PARTIALLY_FULFILLED", "FULFILLED"}:
        return OrderStatus.shipped

    return OrderStatus.pending


def map_shopify_tracking_status(shopify_order: ShopifyOrder) -> str | None:
    if shopify_order.latest_tracking_status:
        return shopify_order.latest_tracking_status

    if shopify_order.tracking_number or shopify_order.tracking_company or shopify_order.tracking_url:
        logger.info(
            "Shopify order %s has tracking info but no fine-grained tracking status. fulfillments=%s",
            shopify_order.name or shopify_order.id,
            [
                {
                    "name": fulfillment.name,
                    "display_status": fulfillment.display_status,
                    "in_transit_at": fulfillment.in_transit_at,
                    "delivered_at": fulfillment.delivered_at,
                    "updated_at": fulfillment.updated_at,
                    "tracking_company": fulfillment.tracking_company,
                    "tracking_number": fulfillment.tracking_number,
                    "tracking_url": fulfillment.tracking_url,
                    "events": [event.status for event in fulfillment.events],
                }
                for fulfillment in shopify_order.fulfillments
            ],
        )

    return None


def fetch_recent_orders(
    shop_domain: str,
    access_token: str,
    first: int | None = None,
    updated_since: datetime | None = None,
) -> list[ShopifyOrder]:
    max_orders = first or get_settings().shopify_sync_max_orders
    query_filter = _build_orders_query_filter(updated_since)
    orders: list[ShopifyOrder] = []
    after: str | None = None

    while len(orders) < max_orders:
        batch_size = min(250, max_orders - len(orders))
        parsed = _run_shopify_graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query=RECENT_ORDERS_QUERY,
            variables={
                "first": batch_size,
                "query": query_filter,
                "after": after,
            },
        )
        orders_payload = parsed.get("data", {}).get("orders", {}) or {}
        order_edges = orders_payload.get("edges", []) or []
        if not order_edges:
            break

        orders.extend(_map_order(edge.get("node", {})) for edge in order_edges)

        page_info = orders_payload.get("pageInfo", {}) or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break

    return orders[:max_orders]


def fetch_shopify_order_by_name(
    *,
    shop_domain: str,
    access_token: str,
    order_name: str,
) -> ShopifyOrder | None:
    normalized_name = (order_name or "").strip()
    if not normalized_name:
        return None

    candidates = []
    for candidate in (
        normalized_name,
        normalized_name.removeprefix("#"),
        f"#{normalized_name.removeprefix('#')}",
    ):
        cleaned = candidate.strip()
        if cleaned and cleaned not in candidates:
            candidates.append(cleaned)

    for candidate in candidates:
        parsed = _run_shopify_graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query=ORDER_LINK_BACKFILL_QUERY,
            variables={
                "first": 10,
                "query": f"name:{candidate}",
            },
        )
        orders_payload = parsed.get("data", {}).get("orders", {}) or {}
        order_edges = orders_payload.get("edges", []) or []
        if not order_edges:
            continue

        mapped_orders = [_map_order(edge.get("node", {})) for edge in order_edges]
        exact = next(
            (
                order
                for order in mapped_orders
                if _normalize_order_public_name(order.name) == _normalize_order_public_name(candidate)
            ),
            None,
        )
        if exact is not None:
            return exact

    return None


def fetch_shopify_products(
    shop_domain: str,
    access_token: str,
    first: int = 250,
    updated_since: datetime | None = None,
) -> list[ShopifyCatalogProductPayload]:
    products: list[ShopifyCatalogProductPayload] = []
    after: str | None = None
    query_filter = _build_products_query_filter(updated_since)

    while True:
        parsed = _run_shopify_graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query=PRODUCT_CATALOG_QUERY,
            variables={
                "first": min(max(first, 1), 250),
                "query": query_filter,
                "after": after,
            },
        )
        products_payload = parsed.get("data", {}).get("products", {}) or {}
        product_edges = products_payload.get("edges", []) or []
        if not product_edges:
            break

        products.extend(_map_product(edge.get("node", {})) for edge in product_edges)

        page_info = products_payload.get("pageInfo", {}) or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break

    return products


def fetch_shopify_customers(
    shop_domain: str,
    access_token: str,
    updated_since: datetime | None = None,
) -> list[ShopifyCustomerPayload]:
    customers: list[ShopifyCustomerPayload] = []
    after: str | None = None
    query_filter = _build_customers_query_filter(updated_since)

    while True:
        parsed = _run_shopify_graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query=CUSTOMERS_QUERY,
            variables={
                "first": 100,
                "query": query_filter,
                "after": after,
            },
        )
        customers_payload = parsed.get("data", {}).get("customers", {}) or {}
        customer_edges = customers_payload.get("edges", []) or []
        if not customer_edges:
            break

        customers.extend(_map_customer(edge.get("node", {})) for edge in customer_edges)

        page_info = customers_payload.get("pageInfo", {}) or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break

    return customers


def _run_shopify_graphql(
    *,
    shop_domain: str,
    access_token: str,
    query: str,
    variables: dict,
) -> dict:
    settings = get_settings()
    payload = json.dumps(
        {
            "query": query,
            "variables": variables,
        }
    ).encode("utf-8")
    graphql_request = request.Request(
        _graphql_url(shop_domain),
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": access_token,
        },
    )

    try:
        if settings.shopify_ssl_verify:
            cafile = settings.shopify_ssl_cafile or certifi.where()
            ssl_context = ssl.create_default_context(cafile=cafile)
        else:
            ssl_context = ssl._create_unverified_context()

        with request.urlopen(graphql_request, timeout=20, context=ssl_context) as response:
            response_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        if exc.code in {401, 403}:
            raise ShopifyCredentialsError("Invalid Shopify credentials") from exc
        raise ShopifyServiceError(f"Shopify request failed: {message or exc.reason}") from exc
    except error.URLError as exc:
        raise ShopifyServiceError(f"Could not connect to Shopify: {exc.reason}") from exc
    except ssl.SSLError as exc:
        raise ShopifyServiceError(f"Could not establish a trusted TLS connection to Shopify: {exc}") from exc

    parsed = json.loads(response_body)
    graphql_errors = parsed.get("errors") or []
    if graphql_errors:
        message = graphql_errors[0].get("message", "Unknown Shopify GraphQL error")
        raise ShopifyGraphQLError(message)
    return parsed


def resolve_shopify_access_token(db: Session, integration: ShopIntegration) -> str:
    client_id = (integration.client_id or "").strip()
    client_secret = (integration.client_secret or "").strip()

    if client_id and client_secret:
        token = _request_shopify_client_credentials_token(
            shop_domain=integration.shop_domain,
            client_id=client_id,
            client_secret=client_secret,
        )
        if integration.access_token != token:
            integration.access_token = token
            db.flush()
        return token

    access_token = (integration.access_token or "").strip()
    if access_token:
        return access_token

    raise ShopifyCredentialsError("Missing Shopify credentials")


def _request_shopify_client_credentials_token(
    *,
    shop_domain: str,
    client_id: str,
    client_secret: str,
) -> str:
    settings = get_settings()
    payload = urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    token_request = request.Request(
        f"https://{shop_domain}/admin/oauth/access_token",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
    )

    try:
        if settings.shopify_ssl_verify:
            cafile = settings.shopify_ssl_cafile or certifi.where()
            ssl_context = ssl.create_default_context(cafile=cafile)
        else:
            ssl_context = ssl._create_unverified_context()

        with request.urlopen(token_request, timeout=20, context=ssl_context) as response:
            response_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        if exc.code in {400, 401, 403}:
            raise ShopifyCredentialsError("Invalid Shopify credentials") from exc
        raise ShopifyServiceError(f"Shopify token request failed: {message or exc.reason}") from exc
    except error.URLError as exc:
        raise ShopifyServiceError(f"Could not connect to Shopify: {exc.reason}") from exc
    except ssl.SSLError as exc:
        raise ShopifyServiceError(f"Could not establish a trusted TLS connection to Shopify: {exc}") from exc

    parsed = json.loads(response_body)
    access_token = str(parsed.get("access_token", "")).strip()
    if not access_token:
        raise ShopifyCredentialsError("Shopify did not return an access token")
    return access_token


def import_shopify_orders(
    db: Session,
    integration: ShopIntegration,
    create_missing_orders: bool = True,
    updated_since: datetime | None = None,
    access_token: str | None = None,
) -> ShopifyImportResult:
    recent_orders = fetch_recent_orders(
        shop_domain=integration.shop_domain,
        access_token=access_token or integration.access_token,
        updated_since=updated_since,
    )

    result = ShopifyImportResult(
        imported_count=0,
        updated_count=0,
        skipped_count=0,
        customers_created_count=0,
        customers_updated_count=0,
        shipments_created_count=0,
        shipments_updated_count=0,
        external_ids_migrated_count=0,
        tracking_events_created_count=0,
        incidents_created_count=0,
        total_fetched=len(recent_orders),
    )

    for shopify_order in recent_orders:
        external_id = shopify_public_order_id(shopify_order)
        if not external_id:
            result.skipped_count += 1
            continue

        mapped_status = map_shopify_status_to_internal_order_status(shopify_order)
        customer_name = build_customer_name(
            shopify_order.customer_first_name,
            shopify_order.customer_last_name,
            shopify_order.customer_email,
        )
        customer_email = shopify_customer_email(shopify_order.customer_email)
        upsert_customer_from_order(
            db=db,
            shop_id=integration.shop_id,
            shopify_order=shopify_order,
            order_created_at=parse_shopify_datetime(shopify_order.created_at),
        )

        existing_order, is_ambiguous, external_id_migrated = find_existing_order(
            db=db,
            shop_id=integration.shop_id,
            shopify_order=shopify_order,
        )
        if is_ambiguous:
            result.skipped_count += 1
            continue

        if external_id_migrated:
            result.external_ids_migrated_count += 1
            logger.info(
                "Shopify order %s external_id migrated to public name",
                shopify_public_order_id(shopify_order),
            )

        if existing_order is not None:
            existing_order.external_id = external_id
            existing_order.shopify_order_gid = shopify_order.id
            existing_order.shopify_order_name = shopify_order.name or external_id
            existing_order.customer_external_id = shopify_order.customer_id
            existing_order.status = mapped_status
            existing_order.customer_name = customer_name
            existing_order.customer_email = customer_email
            existing_order.note = shopify_order.note
            existing_order.tags_json = shopify_order.tags or None
            existing_order.channel = shopify_order.source_name
            existing_order.shopify_financial_status = shopify_order.display_financial_status
            existing_order.shopify_fulfillment_status = shopify_order.display_fulfillment_status
            existing_order.fulfillment_orders_json = shopify_order.fulfillment_orders or None
            sync_order_items_from_shopify(existing_order, shopify_order)
            existing_order.is_personalized = infer_order_is_personalized(existing_order.items)

            shipment_sync = sync_tracking_from_shopify(existing_order, shopify_order)
            if shipment_sync.shipment_created:
                result.shipments_created_count += 1
            if shipment_sync.shipment_updated:
                result.shipments_updated_count += 1
            result.tracking_events_created_count += shipment_sync.tracking_events_created_count
            result.incidents_created_count += apply_automatic_incident_rules(existing_order)
            result.updated_count += 1
            continue

        if not create_missing_orders:
            result.skipped_count += 1
            continue

        order_data = {
            "shop_id": integration.shop_id,
            "external_id": external_id,
            "shopify_order_gid": shopify_order.id,
            "shopify_order_name": shopify_order.name or external_id,
            "customer_external_id": shopify_order.customer_id,
            "status": mapped_status,
            "production_status": ProductionStatus.pending_personalization,
            "customer_name": customer_name,
            "customer_email": customer_email,
            "note": shopify_order.note,
            "tags_json": shopify_order.tags or None,
            "channel": shopify_order.source_name,
            "shopify_financial_status": shopify_order.display_financial_status,
            "shopify_fulfillment_status": shopify_order.display_fulfillment_status,
            "fulfillment_orders_json": shopify_order.fulfillment_orders or None,
        }
        imported_created_at = parse_shopify_datetime(shopify_order.created_at)
        if imported_created_at is not None:
            order_data["created_at"] = imported_created_at

        imported_items = [
            build_order_item_from_shopify(shopify_order, line_item)
            for line_item in shopify_order.line_items
        ]
        for imported_item in imported_items:
            if _normalize_shopify_variant_title(imported_item.variant_title):
                continue
            imported_item.variant_title = _resolve_variant_title_from_catalog(
                db,
                integration.shop_id,
                imported_item.variant_id,
                imported_item.sku,
            ) or imported_item.variant_title
        order_data["is_personalized"] = infer_order_is_personalized(imported_items)
        order = Order(**order_data)
        order.items = imported_items

        shipment_sync = sync_tracking_from_shopify(order, shopify_order)
        if shipment_sync.shipment_created:
            result.shipments_created_count += 1
        if shipment_sync.shipment_updated:
            result.shipments_updated_count += 1
        result.tracking_events_created_count += shipment_sync.tracking_events_created_count
        result.incidents_created_count += apply_automatic_incident_rules(order)

        db.add(order)
        result.imported_count += 1

    db.commit()
    return result


def sync_shopify_orders_for_shop(db: Session, integration: ShopIntegration) -> ShopifyImportResult:
    return run_shopify_sync_cycle(
        db=db,
        integration=integration,
        create_missing_orders=True,
        full_sync=False,
        source="manual_sync",
    )


def run_shopify_sync_cycle(
    db: Session,
    integration: ShopIntegration,
    create_missing_orders: bool,
    full_sync: bool,
    source: str,
) -> ShopifyImportResult:
    sync_event = ShopSyncEvent(
        shop_id=integration.shop_id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(sync_event)
    db.flush()

    try:
        access_token = resolve_shopify_access_token(db, integration)
        updated_since = None if full_sync else integration.last_synced_at
        result = import_shopify_orders(
            db=db,
            integration=integration,
            create_missing_orders=create_missing_orders,
            updated_since=updated_since,
            access_token=access_token,
        )
        customers_created_count, customers_updated_count = sync_shopify_customers_for_shop(
            db=db,
            integration=integration,
            updated_since=updated_since,
            access_token=access_token,
        )
        result.customers_created_count += customers_created_count
        result.customers_updated_count += customers_updated_count
        should_run_backfill = full_sync or source in {"manual_import", "manual_validation", "backfill"}
        backfilled_variant_orders_count = 0
        if should_run_backfill:
            try:
                backfilled_variant_orders_count = backfill_missing_shopify_order_links(
                    db=db,
                    integration=integration,
                    max_orders=get_settings().shopify_sync_max_orders,
                )
            except Exception as exc:
                logger.warning(
                    "Shopify backfill skipped for shop_id=%s after sync success: %s",
                    integration.shop_id,
                    exc,
                )
        finished_at = datetime.now(timezone.utc)
        summary = {
            "source": source,
            "mode": "full" if full_sync else "incremental",
            "imported_count": result.imported_count,
            "updated_count": result.updated_count,
            "skipped_count": result.skipped_count,
            "customers_created_count": result.customers_created_count,
            "customers_updated_count": result.customers_updated_count,
            "shipments_created_count": result.shipments_created_count,
            "shipments_updated_count": result.shipments_updated_count,
            "external_ids_migrated_count": result.external_ids_migrated_count,
            "tracking_events_created_count": result.tracking_events_created_count,
            "incidents_created_count": result.incidents_created_count,
            "total_fetched": result.total_fetched,
            "backfilled_variant_orders_count": backfilled_variant_orders_count,
        }
        integration.last_synced_at = finished_at
        integration.last_sync_status = "success"
        integration.last_sync_summary = summary
        integration.last_error_message = None
        sync_event.finished_at = finished_at
        sync_event.imported_count = result.imported_count
        sync_event.updated_count = result.updated_count
        sync_event.shipments_created_count = result.shipments_created_count
        sync_event.incidents_created_count = result.incidents_created_count
        sync_event.error_message = None
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        finished_at = datetime.now(timezone.utc)
        integration = db.get(ShopIntegration, integration.id)
        if integration is None:
            raise
        error_message = _truncate_sync_error(str(exc))
        sync_event = ShopSyncEvent(
            shop_id=integration.shop_id,
            started_at=sync_event.started_at,
            finished_at=finished_at,
            error_message=error_message,
        )
        db.add(sync_event)
        integration.last_synced_at = finished_at
        integration.last_sync_status = "failed"
        integration.last_sync_summary = {
            "source": source,
            "mode": "full" if full_sync else "incremental",
            "error_message": error_message,
        }
        integration.last_error_message = error_message
        db.commit()
        raise


def sync_all_active_shopify_integrations(db: Session) -> list[ShopifyImportResult]:
    integrations = list(
        db.scalars(
            select(ShopIntegration).where(
                ShopIntegration.provider == SHOPIFY_PROVIDER,
                ShopIntegration.is_active.is_(True),
            )
        )
    )
    results: list[ShopifyImportResult] = []
    for integration in integrations:
        results.append(
            sync_shopify_shop(integration.shop_id, full_sync=False, source="scheduler")
        )
    return results


def sync_shopify_shop(
    shop_id: int,
    *,
    full_sync: bool = False,
    source: str = "manual",
) -> ShopifyImportResult:
    _acquire_shop_sync_lock(shop_id)
    try:
        with SessionLocal() as db:
            integration = db.scalar(
                select(ShopIntegration).where(
                    ShopIntegration.shop_id == shop_id,
                    ShopIntegration.provider == SHOPIFY_PROVIDER,
                    ShopIntegration.is_active.is_(True),
                )
            )
            if integration is None:
                raise ShopifyIntegrationNotFoundError("Active Shopify integration not found")

            return run_shopify_sync_cycle(
                db=db,
                integration=integration,
                create_missing_orders=True,
                full_sync=full_sync,
                source=source,
            )
    finally:
        _release_shop_sync_lock(shop_id)


def sync_shopify_catalog_for_shop(db: Session, shop_id: int) -> ShopifyCatalogSyncResult:
    integration = db.scalar(
        select(ShopIntegration).where(
            ShopIntegration.shop_id == shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
    )
    if integration is None:
        raise ShopifyIntegrationNotFoundError("Active Shopify integration not found")

    access_token = resolve_shopify_access_token(db, integration)
    updated_since = integration.last_synced_at
    products = fetch_shopify_products(
        shop_domain=integration.shop_domain,
        access_token=access_token,
        updated_since=updated_since,
    )
    existing_products = {
        product.external_product_id: product
        for product in db.scalars(select(ShopCatalogProduct).where(ShopCatalogProduct.shop_id == shop_id))
    }
    existing_variants = {
        variant.external_variant_id: variant
        for variant in db.scalars(select(ShopCatalogVariant).where(ShopCatalogVariant.shop_id == shop_id))
    }

    created_count = 0
    updated_count = 0
    now = datetime.now(timezone.utc)

    for payload in products:
        existing = existing_products.get(payload.external_product_id)
        if existing is None:
            db.add(
                ShopCatalogProduct(
                    shop_id=shop_id,
                    provider=SHOPIFY_PROVIDER,
                    external_product_id=payload.external_product_id,
                    title=payload.title,
                    handle=payload.handle,
                    vendor=payload.vendor,
                    product_type=payload.product_type,
                    status=payload.status,
                    image_url=payload.image_url,
                    variants_json=[_serialize_catalog_variant(variant) for variant in payload.variants],
                    external_created_at=payload.created_at,
                    external_updated_at=payload.updated_at,
                    synced_at=now,
                )
            )
            created_product = existing_products.get(payload.external_product_id)
            if created_product is None:
                created_product = db.scalar(
                    select(ShopCatalogProduct).where(
                        ShopCatalogProduct.shop_id == shop_id,
                        ShopCatalogProduct.external_product_id == payload.external_product_id,
                    )
                )
            if created_product is not None:
                _sync_product_variants(
                    db=db,
                    product=created_product,
                    variants=payload.variants,
                    existing_variants=existing_variants,
                    now=now,
                )
            created_count += 1
            continue

        existing.title = payload.title
        existing.handle = payload.handle
        existing.vendor = payload.vendor
        existing.product_type = payload.product_type
        existing.status = payload.status
        existing.image_url = payload.image_url
        existing.variants_json = [_serialize_catalog_variant(variant) for variant in payload.variants]
        existing.external_created_at = payload.created_at
        existing.external_updated_at = payload.updated_at
        existing.synced_at = now
        _sync_product_variants(
            db=db,
            product=existing,
            variants=payload.variants,
            existing_variants=existing_variants,
            now=now,
        )
        updated_count += 1

    integration.last_synced_at = now
    integration.last_sync_status = "success"
    integration.last_sync_summary = {
        "source": "catalog_sync",
        "mode": "incremental" if updated_since else "full",
        "catalog_fetched_count": len(products),
        "catalog_created_count": created_count,
        "catalog_updated_count": updated_count,
    }
    integration.last_error_message = None
    db.commit()
    return ShopifyCatalogSyncResult(
        fetched_count=len(products),
        created_count=created_count,
        updated_count=updated_count,
    )


def sync_shopify_customers_for_shop(
    db: Session,
    integration: ShopIntegration,
    updated_since: datetime | None = None,
    access_token: str | None = None,
) -> tuple[int, int]:
    created_count = 0
    updated_count = 0
    for payload in fetch_shopify_customers(
        shop_domain=integration.shop_domain,
        access_token=access_token or integration.access_token,
        updated_since=updated_since,
    ):
        created, updated = upsert_shop_customer(db, integration.shop_id, payload)
        created_count += int(created)
        updated_count += int(updated)
    return created_count, updated_count


def _acquire_shop_sync_lock(shop_id: int) -> None:
    with _sync_lock:
        if shop_id in _running_shop_syncs:
            raise ShopifySyncInProgressError(f"Shopify sync already running for shop {shop_id}")
        _running_shop_syncs.add(shop_id)


def _release_shop_sync_lock(shop_id: int) -> None:
    with _sync_lock:
        _running_shop_syncs.discard(shop_id)


def build_customer_name(first_name: str | None, last_name: str | None, email: str | None) -> str:
    full_name = " ".join(part.strip() for part in [first_name or "", last_name or ""] if part.strip())
    if full_name:
        return full_name
    if email:
        return email
    return "Unknown customer"


def parse_shopify_datetime(value: str) -> datetime | None:
    if not value:
        return None

    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def shopify_customer_email(value: str | None) -> str:
    return value or ""


def shopify_public_order_id(shopify_order: ShopifyOrder) -> str:
    return (shopify_order.name or "").strip()


def find_existing_order(
    db: Session,
    shop_id: int,
    shopify_order: ShopifyOrder,
) -> tuple[Order | None, bool, bool]:
    public_external_id = shopify_public_order_id(shopify_order)
    candidate_external_ids = [value for value in {public_external_id, shopify_order.id.strip()} if value]
    conditions = []
    if candidate_external_ids:
        conditions.append(Order.external_id.in_(candidate_external_ids))
    if shopify_order.id.strip():
        conditions.append(Order.shopify_order_gid == shopify_order.id.strip())
    if not conditions:
        return None, False, False

    existing_orders = list(
        db.scalars(
            select(Order)
            .where(
                Order.shop_id == shop_id,
                sa.or_(*conditions),
            )
            .options(
                selectinload(Order.items),
                selectinload(Order.incidents),
                selectinload(Order.shipment).selectinload(Shipment.events),
            )
        )
    )
    if len(existing_orders) != 1:
        return None, len(existing_orders) > 1, False

    existing_order = existing_orders[0]
    external_id_migrated = False
    if (
        public_external_id
        and existing_order.external_id.startswith("gid://shopify/Order/")
        and existing_order.external_id != public_external_id
    ):
        existing_order.external_id = public_external_id
        external_id_migrated = True

    return existing_order, False, external_id_migrated


def upsert_customer_from_order(
    *,
    db: Session,
    shop_id: int,
    shopify_order: ShopifyOrder,
    order_created_at: datetime | None,
) -> tuple[bool, bool]:
    if not shopify_order.customer_id:
        return False, False

    payload = ShopifyCustomerPayload(
        external_customer_id=shopify_order.customer_id,
        first_name=shopify_order.customer_first_name,
        last_name=shopify_order.customer_last_name,
        name=build_customer_name(
            shopify_order.customer_first_name,
            shopify_order.customer_last_name,
            shopify_order.customer_email,
        ),
        email=shopify_order.customer_email,
        phone=shopify_order.customer_phone,
        tags=shopify_order.tags,
        number_of_orders=None,
        default_address=None,
        last_order_at=order_created_at,
    )
    return upsert_shop_customer(db, shop_id, payload)


def upsert_shop_customer(
    db: Session,
    shop_id: int,
    payload: ShopifyCustomerPayload,
) -> tuple[bool, bool]:
    existing = db.scalar(
        select(ShopCustomer).where(
            ShopCustomer.shop_id == shop_id,
            ShopCustomer.provider == SHOPIFY_PROVIDER,
            ShopCustomer.external_customer_id == payload.external_customer_id,
        )
    )
    now = datetime.now(timezone.utc)
    if existing is None:
        customer = ShopCustomer(
            shop_id=shop_id,
            provider=SHOPIFY_PROVIDER,
            external_customer_id=payload.external_customer_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            name=payload.name,
            email=payload.email,
            phone=payload.phone,
            tags_json=payload.tags or None,
            default_address_json=payload.default_address,
            total_orders=payload.number_of_orders,
            last_order_at=payload.last_order_at,
            external_updated_at=payload.last_order_at,
            synced_at=now,
        )
        db.add(customer)
        db.flush([customer])
        return True, False

    existing.first_name = payload.first_name or existing.first_name
    existing.last_name = payload.last_name or existing.last_name
    existing.name = payload.name or existing.name
    existing.email = payload.email or existing.email
    existing.phone = payload.phone or existing.phone
    if payload.tags:
        existing.tags_json = payload.tags
    if payload.default_address is not None:
        existing.default_address_json = payload.default_address
    if payload.number_of_orders is not None:
        existing.total_orders = payload.number_of_orders
    if payload.last_order_at is not None and (
        existing.last_order_at is None or payload.last_order_at > existing.last_order_at
    ):
        existing.last_order_at = payload.last_order_at
    if payload.last_order_at is not None:
        existing.external_updated_at = payload.last_order_at
    existing.synced_at = now
    return False, True


def maybe_create_imported_shipment(order: Order, shopify_order: ShopifyOrder) -> bool:
    if order.shipment is not None:
        return False

    primary_fulfillment = _select_primary_fulfillment(shopify_order.fulfillments)
    carrier = ((primary_fulfillment.tracking_company if primary_fulfillment else None) or shopify_order.tracking_company or "").strip()
    tracking_number = ((primary_fulfillment.tracking_number if primary_fulfillment else None) or shopify_order.tracking_number or "").strip()
    tracking_url = ((primary_fulfillment.tracking_url if primary_fulfillment else None) or shopify_order.tracking_url or "").strip()
    tracking_status = map_shopify_tracking_status(shopify_order)
    tracking_status_detail = (primary_fulfillment.display_status if primary_fulfillment else None) or tracking_status

    if not carrier and not tracking_number and not tracking_url and not tracking_status:
        return False

    order.shipment = Shipment(
        fulfillment_id=primary_fulfillment.id if primary_fulfillment else None,
        carrier=carrier or "Shopify fulfillment",
        tracking_number=tracking_number or "",
        tracking_url=tracking_url or None,
        shipping_status=tracking_status,
        shipping_status_detail=tracking_status_detail,
    )
    logger.info("Shopify order %s shipment created", shopify_public_order_id(shopify_order))
    return True


def sync_tracking_from_shopify(order: Order, shopify_order: ShopifyOrder) -> ShipmentSyncResult:
    result = ShipmentSyncResult()
    result.shipment_created = maybe_create_imported_shipment(order, shopify_order)

    shipment = order.shipment
    if shipment is None:
        logger.info("Shopify order %s no tracking usable", shopify_public_order_id(shopify_order))
        return result

    if _complete_existing_shipment(shipment, shopify_order):
        result.shipment_updated = True

    timeline_events = _build_tracking_events_from_shopify(shopify_order)
    if not timeline_events:
        logger.info("Shopify order %s no fine-grained tracking event created", shopify_public_order_id(shopify_order))
        return result

    latest_status: str | None = None
    for status_norm, status_raw, occurred_at in timeline_events:
        latest_status = status_norm
        if _tracking_event_exists(shipment, status_norm, occurred_at):
            continue
        shipment.events.append(
            TrackingEvent(
                status_norm=status_norm,
                status_raw=status_raw,
                occurred_at=occurred_at,
            )
        )
        result.tracking_events_created_count += 1

    if latest_status:
        shipment.shipping_status = latest_status
        primary_fulfillment = _select_primary_fulfillment(shopify_order.fulfillments)
        shipment.shipping_status_detail = (primary_fulfillment.display_status if primary_fulfillment else None) or latest_status
        sync_order_status_from_tracking(order, latest_status)
    return result


def _complete_existing_shipment(shipment: Shipment, shopify_order: ShopifyOrder) -> bool:
    updated = False
    primary_fulfillment = _select_primary_fulfillment(shopify_order.fulfillments)
    carrier = ((primary_fulfillment.tracking_company if primary_fulfillment else None) or shopify_order.tracking_company or "").strip()
    tracking_number = ((primary_fulfillment.tracking_number if primary_fulfillment else None) or shopify_order.tracking_number or "").strip()
    tracking_url = ((primary_fulfillment.tracking_url if primary_fulfillment else None) or shopify_order.tracking_url or "").strip()
    tracking_status = map_shopify_tracking_status(shopify_order)
    tracking_status_detail = (primary_fulfillment.display_status if primary_fulfillment else None) or tracking_status

    if primary_fulfillment and shipment.fulfillment_id != primary_fulfillment.id:
        shipment.fulfillment_id = primary_fulfillment.id
        updated = True

    if not shipment.carrier.strip() and carrier:
        shipment.carrier = carrier
        updated = True
    elif carrier and shipment.carrier != carrier:
        shipment.carrier = carrier
        updated = True

    if not shipment.tracking_number.strip():
        if tracking_number:
            shipment.tracking_number = tracking_number
            updated = True
    elif tracking_number and shipment.tracking_number != tracking_number:
        shipment.tracking_number = tracking_number
        updated = True

    if tracking_url and shipment.tracking_url != tracking_url:
        shipment.tracking_url = tracking_url
        updated = True

    if tracking_status and shipment.shipping_status != tracking_status:
        shipment.shipping_status = tracking_status
        updated = True

    if tracking_status_detail and shipment.shipping_status_detail != tracking_status_detail:
        shipment.shipping_status_detail = tracking_status_detail
        updated = True

    if updated:
        logger.info("Shopify order %s shipment updated", shopify_public_order_id(shopify_order))

    return updated


def _tracking_event_exists(shipment: Shipment, status_norm: str, occurred_at: datetime) -> bool:
    for existing_event in shipment.events:
        if existing_event.status_norm == status_norm and existing_event.occurred_at == occurred_at:
            return True
    return False


def _select_primary_fulfillment(fulfillments: list[ShopifyFulfillment]) -> ShopifyFulfillment | None:
    if not fulfillments:
        return None

    def sort_key(fulfillment: ShopifyFulfillment) -> tuple[datetime, str]:
        timestamp = (
            parse_shopify_datetime(fulfillment.delivered_at or "")
            or parse_shopify_datetime(fulfillment.in_transit_at or "")
            or parse_shopify_datetime(fulfillment.updated_at or "")
            or datetime.fromtimestamp(0, tz=timezone.utc)
        )
        return (timestamp, fulfillment.id or "")

    return max(fulfillments, key=sort_key)


def _build_tracking_events_from_shopify(shopify_order: ShopifyOrder) -> list[tuple[str, str, datetime]]:
    timeline: list[tuple[str, str, datetime]] = []

    for fulfillment in shopify_order.fulfillments:
        for event in fulfillment.events:
            status_norm = _map_fulfillment_event_status(event.status)
            occurred_at = parse_shopify_datetime(event.happened_at)
            if not status_norm or occurred_at is None:
                continue
            timeline.append((status_norm, f"shopify:{event.status}", occurred_at))

        if fulfillment.in_transit_at:
            occurred_at = parse_shopify_datetime(fulfillment.in_transit_at)
            if occurred_at is not None:
                timeline.append(("in_transit", "shopify:IN_TRANSIT", occurred_at))
        if fulfillment.delivered_at:
            occurred_at = parse_shopify_datetime(fulfillment.delivered_at)
            if occurred_at is not None:
                timeline.append(("delivered", "shopify:DELIVERED", occurred_at))

    if not timeline and shopify_order.latest_tracking_status:
        occurred_at = parse_shopify_datetime(shopify_order.latest_tracking_occurred_at or "") or parse_shopify_datetime(shopify_order.created_at or "") or datetime.now(timezone.utc)
        timeline.append((shopify_order.latest_tracking_status, f"shopify:{shopify_order.latest_tracking_status}", occurred_at))

    timeline.sort(key=lambda item: (item[2], item[0]))
    return timeline


def _graphql_url(shop_domain: str) -> str:
    return f"https://{shop_domain}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"


def _build_orders_query_filter(updated_since: datetime | None) -> str | None:
    if updated_since is None:
        return None

    normalized = updated_since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"updated_at:>={normalized}"


def _build_customers_query_filter(updated_since: datetime | None) -> str | None:
    if updated_since is None:
        return None

    normalized = updated_since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"updated_at:>={normalized}"


def _build_products_query_filter(updated_since: datetime | None) -> str | None:
    if updated_since is None:
        return None

    normalized = updated_since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"updated_at:>={normalized}"


def _normalize_order_public_name(value: str | None) -> str:
    return (value or "").strip().removeprefix("#").strip()


def _map_order(node: dict) -> ShopifyOrder:
    customer = node.get("customer") or {}
    raw_fulfillments = node.get("fulfillments", [])
    fulfillment_nodes = raw_fulfillments.get("nodes", []) if isinstance(raw_fulfillments, dict) else (raw_fulfillments or [])
    raw_fulfillment_orders = node.get("fulfillmentOrders", {})
    fulfillment_order_nodes = raw_fulfillment_orders.get("nodes", []) if isinstance(raw_fulfillment_orders, dict) else (raw_fulfillment_orders or [])
    line_item_nodes = node.get("lineItems", {}).get("nodes", [])
    order_custom_attributes = _map_attributes(node.get("customAttributes") or [])

    fulfillments = [_map_fulfillment(fulfillment_node) for fulfillment_node in fulfillment_nodes]
    tracking_info = _first_tracking_info(fulfillments)
    latest_tracking_event = _latest_tracking_event(fulfillments)

    return ShopifyOrder(
        id=str(node.get("id", "")),
        name=str(node.get("name", "")),
        source_name=_clean_text(node.get("sourceName")),
        display_financial_status=node.get("displayFinancialStatus"),
        display_fulfillment_status=node.get("displayFulfillmentStatus"),
        cancelled_at=node.get("cancelledAt"),
        created_at=str(node.get("createdAt", "")),
        note=node.get("note"),
        tags=[tag for tag in (node.get("tags") or []) if isinstance(tag, str) and tag.strip()],
        customer_id=_clean_text(customer.get("id")),
        customer_first_name=customer.get("firstName"),
        customer_last_name=customer.get("lastName"),
        customer_email=customer.get("email"),
        customer_phone=_clean_text(customer.get("phone")),
        custom_attributes=order_custom_attributes,
        fulfillment_orders=[_map_fulfillment_order_snapshot(node) for node in fulfillment_order_nodes],
        tracking_company=tracking_info.get("company"),
        tracking_number=tracking_info.get("number"),
        tracking_url=tracking_info.get("url"),
        latest_tracking_status=_map_fulfillment_event_status(
            latest_tracking_event.status if latest_tracking_event else None
        ),
        latest_tracking_occurred_at=latest_tracking_event.happened_at if latest_tracking_event else None,
        fulfillments=fulfillments,
        line_items=[
            _map_line_item(item_node, node.get("note"), order_custom_attributes)
            for item_node in line_item_nodes
        ],
    )


def _map_product(node: dict) -> ShopifyCatalogProductPayload:
    variant_nodes = node.get("variants", {}).get("nodes", []) or []

    return ShopifyCatalogProductPayload(
        external_product_id=_clean_text(node.get("id")) or "",
        title=_clean_text(node.get("title")) or "Untitled product",
        handle=_clean_text(node.get("handle")),
        vendor=_clean_text(node.get("vendor")),
        product_type=_clean_text(node.get("productType")),
        status=_clean_text(node.get("status")),
        image_url=_clean_text((node.get("featuredImage") or {}).get("url")),
        variants=[_map_catalog_variant(variant) for variant in variant_nodes],
        created_at=parse_shopify_datetime(_clean_text(node.get("createdAt")) or ""),
        updated_at=parse_shopify_datetime(_clean_text(node.get("updatedAt")) or ""),
    )


def _map_customer(node: dict) -> ShopifyCustomerPayload:
    first_name = _clean_text(node.get("firstName"))
    last_name = _clean_text(node.get("lastName"))
    email = _clean_text(node.get("email"))
    return ShopifyCustomerPayload(
        external_customer_id=_clean_text(node.get("id")) or "",
        first_name=first_name,
        last_name=last_name,
        name=build_customer_name(first_name, last_name, email),
        email=email,
        phone=_clean_text(node.get("phone")),
        tags=[tag for tag in (node.get("tags") or []) if isinstance(tag, str) and tag.strip()],
        number_of_orders=node.get("numberOfOrders"),
        default_address=node.get("defaultAddress") or None,
        last_order_at=parse_shopify_datetime(_clean_text(node.get("updatedAt")) or ""),
    )


def _map_catalog_variant(node: dict) -> ShopifyCatalogVariantPayload:
    return ShopifyCatalogVariantPayload(
        external_variant_id=_clean_text(node.get("id")) or "",
        title=_clean_text(node.get("title")),
        sku=_clean_text(node.get("sku")),
        option_values=[
            {
                "name": _clean_text(option.get("name")),
                "value": _clean_text(option.get("value")),
            }
            for option in (node.get("selectedOptions") or [])
            if _clean_text(option.get("name")) or _clean_text(option.get("value"))
        ],
        created_at=parse_shopify_datetime(_clean_text(node.get("createdAt")) or ""),
        updated_at=parse_shopify_datetime(_clean_text(node.get("updatedAt")) or ""),
    )


def _serialize_catalog_variant(variant: ShopifyCatalogVariantPayload) -> dict:
    return {
        "id": variant.external_variant_id,
        "title": variant.title,
        "sku": variant.sku,
        "option_values": variant.option_values,
        "created_at": variant.created_at.isoformat() if variant.created_at else None,
        "updated_at": variant.updated_at.isoformat() if variant.updated_at else None,
    }


def _map_line_item(
    item_node: dict,
    order_note: str | None,
    order_custom_attributes: dict[str, str],
) -> ShopifyLineItem:
    item_attributes = _map_attributes(item_node.get("customAttributes") or [])
    design_link = _extract_design_link(item_attributes, order_custom_attributes)

    return ShopifyLineItem(
        id=_clean_text(item_node.get("id")),
        title=_clean_text(item_node.get("title")) or _clean_text(item_node.get("name")) or "",
        sku=str(item_node.get("sku", "")),
        quantity=int(item_node.get("quantity", 0)),
        product_id=_clean_text(((item_node.get("variant") or {}).get("product") or {}).get("id")),
        variant_id=_clean_text((item_node.get("variant") or {}).get("id")),
        variant_title=_normalize_shopify_variant_title(_clean_text(item_node.get("variantTitle")))
        or _normalize_shopify_variant_title(_clean_text((item_node.get("variant") or {}).get("title"))),
        custom_attributes=item_attributes,
        customization_id=_extract_customization_id(item_attributes, order_custom_attributes),
        design_link=design_link,
        customization_provider=_infer_customization_provider(
            item_attributes,
            order_custom_attributes,
            design_link,
        ),
        personalization_notes=_build_personalization_notes(
            order_note,
            item_attributes,
            order_custom_attributes,
        ),
        personalization_assets=_extract_personalization_assets(
            item_attributes,
            order_custom_attributes,
        ),
        personalization_details=_merge_personalization_details(
            item_attributes,
            order_custom_attributes,
        ),
    )


def _map_fulfillment(node: dict) -> ShopifyFulfillment:
    tracking_info = (node.get("trackingInfo") or [None])[0] or {}
    event_nodes = node.get("events", {}).get("nodes", [])

    return ShopifyFulfillment(
        id=node.get("id"),
        name=node.get("name"),
        display_status=node.get("displayStatus"),
        in_transit_at=node.get("inTransitAt"),
        delivered_at=node.get("deliveredAt"),
        updated_at=node.get("updatedAt"),
        tracking_company=tracking_info.get("company"),
        tracking_number=tracking_info.get("number"),
        tracking_url=tracking_info.get("url"),
        events=[
            ShopifyFulfillmentEvent(
                status=str(event_node.get("status", "")),
                happened_at=str(event_node.get("happenedAt", "")),
            )
            for event_node in event_nodes
        ],
    )


def _map_fulfillment_order_snapshot(node: dict) -> dict:
    line_item_nodes = ((node.get("lineItems") or {}).get("nodes") or [])
    fulfillment_nodes = ((node.get("fulfillments") or {}).get("nodes") or [])

    return {
        "id": _clean_text(node.get("id")),
        "status": _clean_text(node.get("status")),
        "request_status": _clean_text(node.get("requestStatus")),
        "assigned_location": {
            "id": _clean_text((((node.get("assignedLocation") or {}).get("location") or {}).get("id"))),
            "name": _clean_text((((node.get("assignedLocation") or {}).get("location") or {}).get("name"))),
        },
        "line_items": [
            {
                "line_item_gid": _clean_text(((line_item.get("lineItem") or {}).get("id"))),
                "title": _clean_text(((line_item.get("lineItem") or {}).get("title"))),
                "sku": _clean_text(((line_item.get("lineItem") or {}).get("sku"))),
                "total_quantity": line_item.get("totalQuantity"),
                "remaining_quantity": line_item.get("remainingQuantity"),
            }
            for line_item in line_item_nodes
        ],
        "fulfillments": [
            {
                "id": _clean_text(fulfillment.get("id")),
                "status": _clean_text(fulfillment.get("status")),
                "tracking_info": [
                    {
                        "company": _clean_text(tracking.get("company")),
                        "number": _clean_text(tracking.get("number")),
                        "url": _clean_text(tracking.get("url")),
                    }
                    for tracking in ((fulfillment.get("trackingInfo") or []))
                ],
            }
            for fulfillment in fulfillment_nodes
        ],
    }


def _first_tracking_info(fulfillments: list[ShopifyFulfillment]) -> dict[str, str | None]:
    for fulfillment in fulfillments:
        if fulfillment.tracking_company or fulfillment.tracking_number or fulfillment.tracking_url:
            return {
                "company": fulfillment.tracking_company,
                "number": fulfillment.tracking_number,
                "url": fulfillment.tracking_url,
            }

    return {"company": None, "number": None, "url": None}


def _map_attributes(entries: list[dict]) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for entry in entries:
        key = str(entry.get("key", "")).strip()
        value = str(entry.get("value", "")).strip()
        if key and value:
            mapped[key] = value
    return mapped


def _clean_text(value: object | None) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _normalize_attribute_key(value: str) -> str:
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def _find_attribute_value(attributes: dict[str, str], candidate_keys: set[str]) -> str | None:
    for key, value in attributes.items():
        if _normalize_attribute_key(key) in candidate_keys and value.strip():
            return value.strip()
    return None


def _extract_customization_id(
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
) -> str | None:
    keys = {
        "customization_id",
        "_customization_id",
        "customisation_id",
        "design_id",
        "_design_id",
        "tib_customization_id",
        "_tib_customization_id",
    }
    return _find_attribute_value(line_item_attributes, keys) or _find_attribute_value(order_attributes, keys)


def _extract_design_link(
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
) -> str | None:
    keys = {
        "_tib_design_link_1",
        "_tib_design_link",
        "design_link",
        "design_url",
        "design",
        "artwork_link",
        "artwork_url",
        "preview_url",
        "proof_link",
        "customization_link",
        "customizer_link",
        "design_proof_link",
    }
    for source in (line_item_attributes, order_attributes):
        candidate = _find_attribute_value(source, keys)
        if candidate:
            return candidate
        for value in source.values():
            normalized = value.strip()
            if normalized.startswith("http"):
                return normalized
    return None


def _infer_customization_provider(
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
    design_link: str | None,
) -> str | None:
    normalized_keys = {
        _normalize_attribute_key(key)
        for source in (line_item_attributes, order_attributes)
        for key in source
    }

    if any(key.startswith("_tib_") or "teeinblue" in key for key in normalized_keys):
        return "teeinblue"

    if design_link:
        lowered = design_link.lower()
        if "teeinblue" in lowered or "tib" in lowered:
            return "teeinblue"

    explicit_provider = _find_attribute_value(
        line_item_attributes,
        {"customization_provider", "personalization_provider", "provider"},
    ) or _find_attribute_value(
        order_attributes,
        {"customization_provider", "personalization_provider", "provider"},
    )
    if explicit_provider:
        return explicit_provider.strip().lower()

    return None


def _extract_personalization_assets(
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
) -> list[dict]:
    assets: list[dict] = []
    seen: set[str] = set()
    for source_name, source in (("line_item", line_item_attributes), ("order", order_attributes)):
        for key, value in source.items():
            normalized = value.strip()
            if not normalized.startswith("http") or normalized in seen:
                continue
            seen.add(normalized)
            assets.append(
                {
                    "type": _normalize_attribute_key(key),
                    "url": normalized,
                    "source": source_name,
                    "provider": _infer_customization_provider(line_item_attributes, order_attributes, normalized),
                }
            )
    return assets


def _merge_personalization_details(
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
) -> dict[str, str]:
    merged: dict[str, str] = {}
    for prefix, source in (("line_item", line_item_attributes), ("order", order_attributes)):
        for key, value in source.items():
            if value.strip():
                merged[f"{prefix}.{_normalize_attribute_key(key)}"] = value.strip()
    return merged


def _build_personalization_notes(
    order_note: str | None,
    line_item_attributes: dict[str, str],
    order_attributes: dict[str, str],
) -> str | None:
    notes: list[str] = []
    if order_note and order_note.strip():
        notes.append(order_note.strip())

    for source in (line_item_attributes, order_attributes):
        for key, value in source.items():
            normalized_key = _normalize_attribute_key(key)
            if normalized_key in {
                "customization_id",
                "_customization_id",
                "design_link",
                "design_url",
                "design",
                "artwork_link",
                "artwork_url",
                "preview_url",
                "proof_link",
            }:
                continue
            if value.strip() and not value.strip().startswith("http"):
                notes.append(f"{key}: {value.strip()}")

    if not notes:
        return None

    unique_notes: list[str] = []
    seen: set[str] = set()
    for note in notes:
        if note not in seen:
            seen.add(note)
            unique_notes.append(note)
    return " | ".join(unique_notes)


def _normalize_shopify_variant_title(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.lower() in {"default title", "sin variante", "no variant"}:
        return None
    return normalized


def _variant_title_from_option_values(option_values: object) -> str | None:
    if not isinstance(option_values, list):
        return None
    values: list[str] = []
    for option in option_values:
        if not isinstance(option, dict):
            continue
        value = option.get("value")
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return " · ".join(values) if values else None


def _resolve_variant_title_from_catalog(
    db: Session | None,
    shop_id: int,
    variant_id: str | None,
    sku: str | None,
) -> str | None:
    if db is None:
        return None

    candidate = None
    if variant_id and variant_id.strip():
        candidate = db.scalar(
            select(ShopCatalogVariant).where(
                ShopCatalogVariant.shop_id == shop_id,
                ShopCatalogVariant.external_variant_id == variant_id.strip(),
            )
        )
    if candidate is None:
        return None
    return _normalize_shopify_variant_title(candidate.title) or _variant_title_from_option_values(candidate.option_values_json)


def _order_item_needs_shopify_link(item: OrderItem) -> bool:
    return any(
        (
            not (item.shopify_line_item_gid or "").strip(),
            not (item.product_id or "").strip(),
            not (item.variant_id or "").strip(),
            not _normalize_shopify_variant_title(item.variant_title),
        )
    )


def _snapshot_order_item_links(order: Order) -> list[tuple[int | None, str | None, str | None, str | None, str | None]]:
    return [
        (
            item.id,
            (item.shopify_line_item_gid or "").strip() or None,
            (item.product_id or "").strip() or None,
            (item.variant_id or "").strip() or None,
            _normalize_shopify_variant_title(item.variant_title),
        )
        for item in order.items
    ]


def _order_needs_shopify_tracking_backfill(order: Order) -> bool:
    shipment = order.shipment
    if shipment is None:
        return True
    if not (shipment.tracking_number or "").strip():
        return True
    if not (shipment.tracking_url or "").strip():
        return True
    if not (shipment.fulfillment_id or "").strip():
        return True
    return False


def _snapshot_order_tracking(order: Order) -> tuple[str | None, str | None, str | None, str | None]:
    shipment = order.shipment
    if shipment is None:
        return (None, None, None, None)
    return (
        (shipment.fulfillment_id or "").strip() or None,
        (shipment.carrier or "").strip() or None,
        (shipment.tracking_number or "").strip() or None,
        (shipment.tracking_url or "").strip() or None,
    )


def backfill_missing_shopify_order_links(
    *,
    db: Session,
    integration: ShopIntegration,
    max_orders: int = 100,
) -> int:
    access_token = resolve_shopify_access_token(db, integration)
    candidate_orders = list(
        db.scalars(
            select(Order)
            .where(Order.shop_id == integration.shop_id)
            .where(
                sa.or_(
                    Order.shopify_order_gid.is_(None),
                    Order.items.any(OrderItem.shopify_line_item_gid.is_(None)),
                    Order.items.any(OrderItem.product_id.is_(None)),
                    Order.items.any(OrderItem.variant_id.is_(None)),
                    Order.items.any(OrderItem.variant_title.is_(None)),
                    ~Order.shipment.has(),
                    Order.shipment.has(Shipment.fulfillment_id.is_(None)),
                    Order.shipment.has(Shipment.tracking_number == ""),
                    Order.shipment.has(Shipment.tracking_url.is_(None)),
                )
            )
            .options(
                selectinload(Order.items),
                selectinload(Order.incidents),
                selectinload(Order.shipment).selectinload(Shipment.events),
            )
            .order_by(Order.created_at.desc(), Order.id.desc())
            .limit(max(max_orders, 1))
        )
    )

    updated_orders_count = 0

    for order in candidate_orders:
        needs_link_backfill = any(_order_item_needs_shopify_link(item) for item in order.items)
        needs_tracking_backfill = _order_needs_shopify_tracking_backfill(order)
        if not needs_link_backfill and not needs_tracking_backfill:
            continue

        lookup_name = order.shopify_order_name or order.external_id
        if not (lookup_name or "").strip():
            continue

        shopify_order = fetch_shopify_order_by_name(
            shop_domain=integration.shop_domain,
            access_token=access_token,
            order_name=lookup_name,
        )
        if shopify_order is None:
            logger.info("Shopify backfill could not find order by name %s", lookup_name)
            continue

        before = _snapshot_order_item_links(order)
        before_order_gid = order.shopify_order_gid
        before_tracking = _snapshot_order_tracking(order)

        order.shopify_order_gid = shopify_order.id or order.shopify_order_gid
        order.shopify_order_name = shopify_order.name or order.shopify_order_name or order.external_id
        order.customer_external_id = shopify_order.customer_id or order.customer_external_id
        order.shopify_financial_status = shopify_order.display_financial_status or order.shopify_financial_status
        order.shopify_fulfillment_status = shopify_order.display_fulfillment_status or order.shopify_fulfillment_status
        order.fulfillment_orders_json = shopify_order.fulfillment_orders or order.fulfillment_orders_json

        sync_order_items_from_shopify(order, shopify_order)
        order.is_personalized = infer_order_is_personalized(order.items)
        sync_tracking_from_shopify(order, shopify_order)

        after = _snapshot_order_item_links(order)
        after_tracking = _snapshot_order_tracking(order)
        if before != after or before_order_gid != order.shopify_order_gid or before_tracking != after_tracking:
            updated_orders_count += 1

    return updated_orders_count


def build_order_item_from_shopify(shopify_order: ShopifyOrder, line_item: ShopifyLineItem) -> OrderItem:
    return OrderItem(
        shopify_line_item_gid=line_item.id,
        product_id=line_item.product_id,
        variant_id=line_item.variant_id,
        sku=line_item.sku or "",
        name=line_item.title or "Untitled item",
        title=line_item.title or "Untitled item",
        variant_title=_normalize_shopify_variant_title(line_item.variant_title),
        quantity=max(line_item.quantity, 1),
        properties_json=line_item.custom_attributes or None,
        customization_id=line_item.customization_id,
        design_link=line_item.design_link,
        customization_provider=line_item.customization_provider,
        design_status=infer_design_status(line_item),
        personalization_details_json=line_item.personalization_details or None,
        personalization_notes=line_item.personalization_notes,
        personalization_assets_json=line_item.personalization_assets,
    )


def sync_order_items_from_shopify(order: Order, shopify_order: ShopifyOrder) -> None:
    catalog_session = object_session(order)
    existing_items_by_gid = {item.shopify_line_item_gid: item for item in order.items if item.shopify_line_item_gid}
    existing_items_by_sku = {item.sku: item for item in order.items if item.sku}
    seen_ids: set[int] = set()
    for line_item in shopify_order.line_items:
        item = existing_items_by_gid.get(line_item.id) if line_item.id else None
        if item is None:
            item = existing_items_by_sku.get(line_item.sku)
        if item is None:
            item = next((candidate for candidate in order.items if candidate.name == line_item.title), None)
        if item is None:
            created_item = build_order_item_from_shopify(shopify_order, line_item)
            order.items.append(created_item)
            if getattr(created_item, "id", None) is not None:
                seen_ids.add(created_item.id)
            continue

        if item.id is not None:
            seen_ids.add(item.id)
        item.shopify_line_item_gid = line_item.id or item.shopify_line_item_gid
        item.product_id = line_item.product_id or item.product_id
        item.variant_id = line_item.variant_id or item.variant_id
        item.name = line_item.title or item.name
        item.title = line_item.title or item.title or item.name
        item.variant_title = (
            _normalize_shopify_variant_title(line_item.variant_title)
            or _resolve_variant_title_from_catalog(catalog_session, order.shop_id, line_item.variant_id, line_item.sku)
            or item.variant_title
        )
        item.quantity = max(line_item.quantity, 1)
        if line_item.custom_attributes:
            item.properties_json = line_item.custom_attributes
        item.customization_id = line_item.customization_id or item.customization_id
        item.design_link = line_item.design_link or item.design_link
        item.customization_provider = line_item.customization_provider or item.customization_provider
        item.personalization_notes = line_item.personalization_notes or item.personalization_notes
        if line_item.personalization_assets:
            item.personalization_assets_json = line_item.personalization_assets
        if line_item.personalization_details:
            item.personalization_details_json = line_item.personalization_details
        item.design_status = infer_design_status(item)

    live_item_ids = {item.id for item in order.items if item.id is not None and item.id in seen_ids}
    if live_item_ids:
        order.items[:] = [item for item in order.items if item.id is None or item.id in live_item_ids]

    for item in order.items:
        if _normalize_shopify_variant_title(item.variant_title):
            continue
        item.variant_title = _resolve_variant_title_from_catalog(catalog_session, order.shop_id, item.variant_id, item.sku) or item.variant_title


def apply_automatic_incident_rules(order: Order) -> int:
    created = 0

    has_design_link = any((item.design_link or "").strip() for item in order.items)
    if order.is_personalized and not has_design_link:
        created += _ensure_incident(
            order,
            incident_type=IncidentType.missing_asset,
            title="Pedido personalizado sin design link",
            description="El pedido parece personalizado pero no tiene enlace de diseño asociado.",
            priority=IncidentPriority.high,
        )

    if order.status == OrderStatus.shipped and order.shipment is None:
        created += _ensure_incident(
            order,
            incident_type=IncidentType.shipping_exception,
            title="Pedido enviado sin shipment interno",
            description="Shopify refleja el pedido como expedido pero no existe shipment interno.",
            priority=IncidentPriority.urgent,
        )

    if order.shipment is not None and not order.shipment.events and order.status == OrderStatus.shipped:
        created += _ensure_incident(
            order,
            incident_type=IncidentType.shipping_exception,
            title="Tracking sin eventos",
            description="Existe shipment, pero no hay eventos de tracking finos disponibles.",
            priority=IncidentPriority.medium,
        )

    return created


def _ensure_incident(
    order: Order,
    incident_type: IncidentType,
    title: str,
    description: str,
    priority: IncidentPriority,
) -> int:
    for incident in order.incidents:
        if incident.type == incident_type and incident.title == title and incident.status != IncidentStatus.resolved:
            return 0

    order.incidents.append(
        Incident(
            type=incident_type,
            priority=priority,
            status=IncidentStatus.open,
            title=title,
            description=description,
        )
    )
    return 1


def _latest_tracking_event(fulfillments: list[ShopifyFulfillment]) -> ShopifyFulfillmentEvent | None:
    latest_event = _synthetic_tracking_event(fulfillments)

    for fulfillment in fulfillments:
        for event in fulfillment.events:
            if _map_fulfillment_event_status(event.status) is None:
                continue
            if latest_event is None or _event_sort_key(event.happened_at) > _event_sort_key(
                latest_event.happened_at
            ):
                latest_event = event

    return latest_event


def _synthetic_tracking_event(fulfillments: list[ShopifyFulfillment]) -> ShopifyFulfillmentEvent | None:
    for fulfillment in fulfillments:
        if fulfillment.delivered_at:
            return ShopifyFulfillmentEvent(status="DELIVERED", happened_at=fulfillment.delivered_at)

    for fulfillment in fulfillments:
        if fulfillment.in_transit_at:
            return ShopifyFulfillmentEvent(status="IN_TRANSIT", happened_at=fulfillment.in_transit_at)

    return None


def _map_fulfillment_event_status(status: str | None) -> str | None:
    if not status:
        return None
    return TRACKING_STATUS_MAP.get(status.upper())


def _event_sort_key(value: str) -> float:
    parsed = parse_shopify_datetime(value)
    if parsed is None:
        return float("-inf")
    return parsed.timestamp()
