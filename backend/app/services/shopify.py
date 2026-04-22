from __future__ import annotations

import json
import logging
import ssl
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
from app.models.carrier_config import CarrierConfig
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.orders import infer_design_status, infer_order_is_personalized, sync_order_status_from_tracking


SHOPIFY_PROVIDER = "shopify"
SHOPIFY_API_VERSION = "2026-01"
logger = logging.getLogger(__name__)
SHOPIFY_RECENT_ORDERS_PAGE_SIZE = 50
# Commit and expunge the SQLAlchemy session every N orders during import to
# prevent unbounded memory growth on long syncs (full imports / large shops).
_IMPORT_BATCH_SIZE = 50


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
        cancelReason
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
        shippingAddress {
          firstName
          lastName
          name
          company
          phone
          country
          countryCodeV2
          zip
          address1
          address2
          city
          province
          provinceCode
        }
        shippingLines(first: 10) {
          nodes {
            title
            originalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
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
        fulfillmentOrders(first: 5) {
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
            fulfillments(first: 5) {
              nodes {
                id
                status
                trackingInfo(first: 5) {
                  company
                  number
                  url
                }
              }
            }
            lineItems(first: 10) {
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
        refunds(first: 20) {
          id
          createdAt
          refundLineItems(first: 50) {
            nodes {
              quantity
              lineItem {
                id
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
        cancelReason
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
        shippingAddress {
          firstName
          lastName
          name
          company
          phone
          country
          countryCodeV2
          zip
          address1
          address2
          city
          province
          provinceCode
        }
        shippingLines(first: 10) {
          nodes {
            title
            originalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
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
        fulfillmentOrders(first: 5) {
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
            fulfillments(first: 5) {
              nodes {
                id
                status
                trackingInfo(first: 5) {
                  company
                  number
                  url
                }
              }
            }
            lineItems(first: 10) {
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
        refunds(first: 20) {
          id
          createdAt
          refundLineItems(first: 50) {
            nodes {
              quantity
              lineItem {
                id
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

FULFILLMENT_CREATE_MUTATION = """
mutation FulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
  fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
    fulfillment {
      id
      status
      trackingInfo(first: 10) {
        company
        number
        url
      }
    }
    userErrors {
      field
      message
    }
  }
}
"""

FULFILLMENT_TRACKING_UPDATE_MUTATION = """
mutation FulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
  fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
    fulfillment {
      id
      status
      trackingInfo(first: 10) {
        company
        number
        url
      }
    }
    userErrors {
      field
      message
    }
  }
}
"""


FULFILLMENT_EVENT_CREATE_MUTATION = """
mutation FulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
  fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
    fulfillmentEvent {
      id
      status
      happenedAt
    }
    userErrors {
      field
      message
    }
  }
}
"""

ORDER_TAGS_ADD_MUTATION = """
mutation tagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node {
      id
    }
    userErrors {
      field
      message
    }
  }
}
"""

# Maps our internal shipping_status → Shopify FulfillmentEventStatus enum value
# https://shopify.dev/docs/api/admin-graphql/latest/enums/FulfillmentEventStatus
INTERNAL_TO_SHOPIFY_EVENT_STATUS: dict[str, str] = {
    "label_created":     "CONFIRMED",
    "prepared":          "CONFIRMED",
    "picked_up":         "IN_TRANSIT",
    "in_transit":        "IN_TRANSIT",
    "out_for_delivery":  "OUT_FOR_DELIVERY",
    "delivered":         "DELIVERED",
    "exception":         "FAILURE",
    "stalled":           "FAILURE",
    "pickup_available":  "READY_FOR_PICKUP",
}

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
    refunded_quantity: int
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
    cancel_reason: str | None
    created_at: str
    note: str | None
    tags: list[str]
    customer_id: str | None
    customer_first_name: str | None
    customer_last_name: str | None
    customer_email: str | None
    customer_phone: str | None
    shipping_first_name: str | None
    shipping_last_name: str | None
    shipping_name: str | None
    shipping_company: str | None
    shipping_phone: str | None
    shipping_country: str | None
    shipping_country_code: str | None
    shipping_postal_code: str | None
    shipping_address_line1: str | None
    shipping_address_line2: str | None
    shipping_town: str | None
    shipping_province: str | None
    shipping_province_code: str | None
    shipping_rate_name: str | None
    shipping_rate_amount: float | None
    shipping_rate_currency: str | None
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


class ShopifyFulfillmentSyncError(ShopifyServiceError):
    pass


_sync_lock = threading.Lock()
_running_shop_syncs: set[int] = set()


def map_shopify_status_to_internal_order_status(shopify_order: ShopifyOrder) -> OrderStatus:
    if shopify_order.cancelled_at:
        return OrderStatus.cancelled

    financial_status = (shopify_order.display_financial_status or "").upper()
    if financial_status in {"REFUNDED", "VOIDED"}:
        return OrderStatus.cancelled

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


def build_shopify_shipping_snapshot(shopify_order: ShopifyOrder) -> dict[str, str | None]:
    first_name = shopify_order.shipping_first_name or shopify_order.customer_first_name
    last_name = shopify_order.shipping_last_name or shopify_order.customer_last_name
    full_name = shopify_order.shipping_name or build_customer_name(
        first_name,
        last_name,
        shopify_order.customer_email,
    )

    return {
        "first_name": _clean_text(first_name),
        "last_name": _clean_text(last_name),
        "name": _clean_text(full_name),
        "company": _clean_text(shopify_order.shipping_company),
        "address1": _clean_text(shopify_order.shipping_address_line1),
        "address2": _clean_text(shopify_order.shipping_address_line2),
        "city": _clean_text(shopify_order.shipping_town),
        "province": _clean_text(shopify_order.shipping_province),
        "province_code": _clean_text(shopify_order.shipping_province_code),
        "zip": _clean_text(shopify_order.shipping_postal_code),
        "country": _clean_text(shopify_order.shipping_country),
        "country_code": _clean_text(shopify_order.shipping_country_code),
        "phone": _clean_text(shopify_order.shipping_phone or shopify_order.customer_phone),
        "email": shopify_customer_email(shopify_order.customer_email),
    }


def _iter_recent_orders(
    shop_domain: str,
    access_token: str,
    first: int | None = None,
    updated_since: datetime | None = None,
    custom_query: str | None = None,
) -> Iterator[ShopifyOrder]:
    max_orders = first or get_settings().shopify_sync_max_orders
    query_filter = custom_query if custom_query is not None else _build_orders_query_filter(updated_since)
    fetched = 0
    after: str | None = None

    while fetched < max_orders:
        # This query is intentionally rich because we use it to hydrate
        # customer, customization and fulfillment state in one pass.
        # Shopify's GraphQL cost limit is 1000 per request, so keep the
        # page size conservative to avoid sync failures on real stores.
        batch_size = min(SHOPIFY_RECENT_ORDERS_PAGE_SIZE, max_orders - fetched)
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

        mapped_orders = [_map_order(edge.get("node", {})) for edge in order_edges]
        for order in mapped_orders:
            yield order
        fetched += len(mapped_orders)

        page_info = orders_payload.get("pageInfo", {}) or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break


def fetch_recent_orders(
    shop_domain: str,
    access_token: str,
    first: int | None = None,
    updated_since: datetime | None = None,
) -> list[ShopifyOrder]:
    return list(
        _iter_recent_orders(
            shop_domain=shop_domain,
            access_token=access_token,
            first=first,
            updated_since=updated_since,
        )
    )


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

    if settings.shopify_ssl_verify:
        cafile = settings.shopify_ssl_cafile or certifi.where()
        ssl_context = ssl.create_default_context(cafile=cafile)
    else:
        ssl_context = ssl._create_unverified_context()

    last_exception: Exception | None = None
    for attempt in range(1, 4):
        try:
            with request.urlopen(graphql_request, timeout=20, context=ssl_context) as response:
                response_body = response.read().decode("utf-8")
            break
        except error.HTTPError as exc:
            message = exc.read().decode("utf-8", errors="ignore")
            if exc.code in {401, 403}:
                raise ShopifyCredentialsError("Invalid Shopify credentials") from exc
            raise ShopifyServiceError(f"Shopify request failed: {message or exc.reason}") from exc
        except error.URLError as exc:
            last_exception = exc
            if attempt == 3:
                raise ShopifyServiceError(f"Could not connect to Shopify: {exc.reason}") from exc
            logger.warning(
                "Retrying Shopify GraphQL request after network error attempt=%s shop_domain=%s reason=%s",
                attempt,
                shop_domain,
                exc.reason,
            )
            time.sleep(0.6 * attempt)
        except ssl.SSLError as exc:
            last_exception = exc
            if attempt == 3:
                raise ShopifyServiceError(
                    f"Could not establish a trusted TLS connection to Shopify: {exc}"
                ) from exc
            logger.warning(
                "Retrying Shopify GraphQL request after TLS error attempt=%s shop_domain=%s error=%s",
                attempt,
                shop_domain,
                exc,
            )
            time.sleep(0.6 * attempt)
    else:
        raise ShopifyServiceError(f"Could not connect to Shopify: {last_exception}")

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


def push_tracking_to_shopify(
    *,
    db: Session,
    order: Order,
    tracking_number: str,
    tracking_url: str | None,
    carrier: str,
    notify_customer: bool = False,
) -> tuple[str | None, str | None]:
    integration = db.scalar(
        select(ShopIntegration).where(
            ShopIntegration.shop_id == order.shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
    )
    if integration is None:
        raise ShopifyIntegrationNotFoundError("Active Shopify integration not found")

    access_token = resolve_shopify_access_token(db, integration)
    logger.info(
        "Shopify tracking push start order_id=%s external_id=%s tracking=%s carrier=%s fulfillment_id=%s",
        order.id,
        order.external_id,
        tracking_number,
        carrier,
        order.shipment.fulfillment_id if order.shipment else None,
    )

    if order.shipment and order.shipment.fulfillment_id:
        payload = _run_shopify_graphql(
            shop_domain=integration.shop_domain,
            access_token=access_token,
            query=FULFILLMENT_TRACKING_UPDATE_MUTATION,
            variables={
                "fulfillmentId": order.shipment.fulfillment_id,
                "trackingInfoInput": {
                    "company": carrier,
                    "number": tracking_number,
                    **({"url": tracking_url} if tracking_url else {}),
                },
                "notifyCustomer": notify_customer,
            },
        )
        container = payload.get("data", {}).get("fulfillmentTrackingInfoUpdate", {}) or {}
        _raise_on_shopify_user_errors(container.get("userErrors") or [])
        fulfillment = container.get("fulfillment") or {}
        tracking_info = _extract_tracking_info_nodes(fulfillment.get("trackingInfo"))
        resolved_url = _clean_text((tracking_info[0] or {}).get("url")) if tracking_info else tracking_url
        logger.info(
            "Shopify tracking updated order_id=%s fulfillment_id=%s resolved_tracking_url=%s",
            order.id,
            _clean_text(fulfillment.get("id")) or order.shipment.fulfillment_id,
            resolved_url,
        )
        return _clean_text(fulfillment.get("id")) or order.shipment.fulfillment_id, resolved_url

    fulfillment_order_ids = _extract_open_fulfillment_order_ids(order.fulfillment_orders_json)
    if not fulfillment_order_ids:
        raise ShopifyFulfillmentSyncError("Shopify order has no open fulfillment orders available")

    payload = _run_shopify_graphql(
        shop_domain=integration.shop_domain,
        access_token=access_token,
        query=FULFILLMENT_CREATE_MUTATION,
        variables={
            "fulfillment": {
                "notifyCustomer": notify_customer,
                "trackingInfo": {
                    "company": carrier,
                    "number": tracking_number,
                    **({"url": tracking_url} if tracking_url else {}),
                },
                "lineItemsByFulfillmentOrder": [
                    {"fulfillmentOrderId": fulfillment_order_id}
                    for fulfillment_order_id in fulfillment_order_ids
                ],
            },
            "message": "Shipment created from Brandeate app",
        },
    )
    container = payload.get("data", {}).get("fulfillmentCreate", {}) or {}
    _raise_on_shopify_user_errors(container.get("userErrors") or [])
    fulfillment = container.get("fulfillment") or {}
    tracking_info = _extract_tracking_info_nodes(fulfillment.get("trackingInfo"))
    resolved_url = _clean_text((tracking_info[0] or {}).get("url")) if tracking_info else tracking_url
    logger.info(
        "Shopify fulfillment created order_id=%s fulfillment_id=%s resolved_tracking_url=%s",
        order.id,
        _clean_text(fulfillment.get("id")),
        resolved_url,
    )
    return _clean_text(fulfillment.get("id")), resolved_url


def push_fulfillment_event_to_shopify(
    *,
    integration: ShopIntegration,
    access_token: str,
    fulfillment_id: str,
    shopify_event_status: str,
    happened_at: str | None = None,
    message: str | None = None,
) -> None:
    """Push a single fulfillment event (status update) to Shopify.

    shopify_event_status must be a valid FulfillmentEventStatus enum value:
    CONFIRMED | IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED | FAILURE |
    ATTEMPTED_DELIVERY | READY_FOR_PICKUP | LABEL_PURCHASED | LABEL_PRINTED
    """
    variables: dict = {
        "fulfillmentEvent": {
            "fulfillmentId": fulfillment_id,
            "status": shopify_event_status,
            "happenedAt": happened_at or datetime.now(timezone.utc).isoformat(),
        }
    }
    if message:
        variables["fulfillmentEvent"]["message"] = message

    payload = _run_shopify_graphql(
        shop_domain=integration.shop_domain,
        access_token=access_token,
        query=FULFILLMENT_EVENT_CREATE_MUTATION,
        variables=variables,
    )
    container = payload.get("data", {}).get("fulfillmentEventCreate", {}) or {}
    _raise_on_shopify_user_errors(container.get("userErrors") or [])
    event = container.get("fulfillmentEvent") or {}
    logger.info(
        "Shopify fulfillment event created fulfillment_id=%s status=%s event_id=%s",
        fulfillment_id,
        shopify_event_status,
        _clean_text(event.get("id")),
    )


def add_order_tags_in_shopify(
    *,
    integration: ShopIntegration,
    access_token: str,
    order_gid: str,
    tags: list[str],
) -> None:
    """Add tags to a Shopify order (used for return status signals)."""
    payload = _run_shopify_graphql(
        shop_domain=integration.shop_domain,
        access_token=access_token,
        query=ORDER_TAGS_ADD_MUTATION,
        variables={"id": order_gid, "tags": tags},
    )
    container = payload.get("data", {}).get("tagsAdd", {}) or {}
    _raise_on_shopify_user_errors(container.get("userErrors") or [])
    logger.info("Shopify order tags added order_gid=%s tags=%s", order_gid, tags)


def _resolve_tracking_url_for_shopify(
    *,
    db: Session,
    shop_id: int,
    shipment: Shipment,
) -> tuple[str | None, bool]:
    """Decide which tracking URL to push to Shopify for this shipment.

    Returns ``(url, is_branded)`` where:

    * ``url`` is what should be passed to Shopify's fulfillment mutation.
    * ``is_branded`` is True when we substituted Brandeate's public
      tracking page for the native carrier URL. The caller must use
      this flag to skip writing Shopify's response back to
      ``shipment.tracking_url`` — otherwise we'd clobber the stored
      native URL on the next sync (or lose the branded URL if Shopify
      returns null for an unrecognised host).

    The per-carrier ``use_branded_tracking_link`` flag lives in
    ``CarrierConfig.config_json``. When it's set, and we have both a
    ``FRONTEND_URL`` and a ``shipment.public_token``, we build
    ``{FRONTEND_URL}/tracking/{public_token}``. Otherwise we fall back
    to the native ``shipment.tracking_url``.
    """
    import os

    native_url = (shipment.tracking_url or "").strip() or None
    raw_carrier = (shipment.carrier or "").strip()
    if not raw_carrier:
        return native_url, False

    # ``shipment.carrier`` stores a human label (e.g. "CTT Express") while
    # CarrierConfig.carrier_code stores the short code (e.g. "ctt"). Map
    # the label to a code before looking up the config — otherwise the
    # branded-tracking flag would never match for CTT shipments.
    normalized = raw_carrier.lower()
    carrier_code = normalized
    if normalized.startswith("ctt"):
        carrier_code = "ctt"

    carrier_cfg = db.scalar(
        select(CarrierConfig)
        .where(CarrierConfig.shop_id == shop_id)
        .where(CarrierConfig.carrier_code == carrier_code)
    )
    use_branded = bool(
        carrier_cfg
        and isinstance(carrier_cfg.config_json, dict)
        and carrier_cfg.config_json.get("use_branded_tracking_link") is True
    )
    if not use_branded:
        return native_url, False

    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    token = (shipment.public_token or "").strip()
    if not frontend_url or not token:
        # Flag is on but we can't build the branded URL — fall back to
        # the native URL so we still push *something*.
        return native_url, False

    return f"{frontend_url}/tracking/{token}", True


def sync_shipment_tracking_to_shopify(
    *,
    db: Session,
    order: Order,
    shipment: Shipment,
    notify_customer: bool = False,
    force: bool = False,
) -> str:
    now = datetime.now(timezone.utc)
    shipment.shopify_last_sync_attempt_at = now

    tracking_number = (shipment.tracking_number or "").strip()
    tracking_url, tracking_url_is_branded = _resolve_tracking_url_for_shopify(
        db=db, shop_id=order.shop_id, shipment=shipment,
    )
    carrier = (shipment.carrier or "").strip()

    if not tracking_number or not carrier:
        shipment.shopify_sync_status = "skipped"
        shipment.shopify_sync_error = "Missing carrier or tracking number for Shopify sync"
        return shipment.shopify_sync_status

    if (
        not force
        and
        (shipment.shopify_sync_status or "").strip() == "synced"
        and (shipment.fulfillment_id or "").strip()
        and shipment.shopify_synced_at is not None
    ):
        shipment.shopify_sync_error = None
        return "synced"

    # Always notify the customer on the FIRST fulfillment creation (the "your order has
    # shipped" email). For subsequent tracking updates keep the caller's preference.
    is_new_fulfillment = not (shipment.fulfillment_id or "").strip()
    effective_notify_customer = True if is_new_fulfillment else notify_customer

    try:
        fulfillment_id, resolved_tracking_url = push_tracking_to_shopify(
            db=db,
            order=order,
            tracking_number=tracking_number,
            tracking_url=tracking_url,
            carrier=carrier,
            notify_customer=effective_notify_customer,
        )
    except ShopifyIntegrationNotFoundError as exc:
        shipment.shopify_sync_status = "not_configured"
        shipment.shopify_sync_error = _truncate_sync_error(str(exc))
        logger.warning("Shopify sync skipped for order_id=%s shipment_id=%s: %s", order.id, shipment.id, exc)
        return shipment.shopify_sync_status
    except ShopifyFulfillmentSyncError as exc:
        shipment.shopify_sync_status = "failed"
        shipment.shopify_sync_error = _truncate_sync_error(str(exc))
        logger.warning("Shopify sync failed for order_id=%s shipment_id=%s: %s", order.id, shipment.id, exc)
        return shipment.shopify_sync_status

    if fulfillment_id:
        shipment.fulfillment_id = fulfillment_id
    # Only write Shopify's response back into shipment.tracking_url when
    # we pushed the *native* carrier URL. If the shop opted into
    # Brandeate's branded tracking page we keep shipment.tracking_url as
    # the native URL (so internal views, labels, etc. still link to the
    # real carrier page) and the branded URL lives only on Shopify's
    # side. Overwriting here would either (a) persist the branded URL
    # and hide the native one, or (b) wipe shipment.tracking_url to
    # null if Shopify didn't recognise our branded host.
    if resolved_tracking_url and not tracking_url_is_branded:
        shipment.tracking_url = resolved_tracking_url

    shipment.shopify_sync_status = "synced"
    shipment.shopify_sync_error = None
    shipment.shopify_synced_at = now
    order.shopify_fulfillment_status = "FULFILLED"
    logger.info(
        "Shopify sync completed order_id=%s shipment_id=%s fulfillment_id=%s tracking=%s notify_customer=%s",
        order.id,
        shipment.id,
        shipment.fulfillment_id,
        shipment.tracking_number,
        effective_notify_customer,
    )

    # ── Push fulfillment status event ──────────────────────────────────────
    # After creating/updating the fulfillment, push the current shipping status
    # as a fulfillment event so Shopify (and the customer) see the correct state.
    push_pending_shipment_status_event(db=db, order=order, shipment=shipment)

    return shipment.shopify_sync_status


def push_pending_shipment_status_event(
    *,
    db: Session,
    order: Order,
    shipment: Shipment,
) -> None:
    """Push a Shopify fulfillment event for the shipment's current status if it has
    not been pushed yet. Safe to call at any time — deduplicates via
    shipment.shopify_status_event_pushed (stores comma-separated set of all statuses
    ever pushed, so each status is only pushed once per shipment). Never raises."""

    current_status = (shipment.shipping_status or "").strip() or None
    pushed_raw = (shipment.shopify_status_event_pushed or "").strip()
    # Support both legacy single-value ("delivered") and new set format ("in_transit,delivered")
    pushed_set: set[str] = {s for s in pushed_raw.split(",") if s}
    fulfillment_id = (shipment.fulfillment_id or "").strip() or None

    if not fulfillment_id or not current_status:
        return

    shopify_event_status = INTERNAL_TO_SHOPIFY_EVENT_STATUS.get(current_status)
    if not shopify_event_status:
        logger.debug(
            "No Shopify event mapping for status=%s shipment_id=%s — skipping event push",
            current_status,
            shipment.id,
        )
        return

    if current_status in pushed_set:
        logger.debug(
            "Status %s already pushed to Shopify for shipment_id=%s — skipping",
            current_status,
            shipment.id,
        )
        return

    integration = db.scalar(
        select(ShopIntegration).where(
            ShopIntegration.shop_id == order.shop_id,
            ShopIntegration.provider == SHOPIFY_PROVIDER,
            ShopIntegration.is_active.is_(True),
        )
    )
    if integration is None:
        logger.debug("No active Shopify integration for shop_id=%s — skipping event push", order.shop_id)
        return

    access_token = resolve_shopify_access_token(db, integration)

    STATUS_MESSAGES: dict[str, str] = {
        "CONFIRMED":         "Pedido confirmado y en preparación",
        "IN_TRANSIT":        "Envío recogido — en tránsito",
        "OUT_FOR_DELIVERY":  "El paquete está en reparto. ¡Hoy podría llegar!",
        "DELIVERED":         "¡Entregado! Esperamos que estés disfrutando tu pedido.",
        "FAILURE":           "Incidencia en la entrega. Estamos gestionándolo.",
        "READY_FOR_PICKUP":  "Tu pedido está listo para recogida",
        "ATTEMPTED_DELIVERY": "Se intentó la entrega sin éxito. Se realizará un nuevo intento.",
    }

    try:
        push_fulfillment_event_to_shopify(
            integration=integration,
            access_token=access_token,
            fulfillment_id=fulfillment_id,
            shopify_event_status=shopify_event_status,
            message=STATUS_MESSAGES.get(shopify_event_status),
        )
        pushed_set.add(current_status)
        shipment.shopify_status_event_pushed = ",".join(sorted(pushed_set))
        logger.info(
            "Shopify status event pushed shipment_id=%s status=%s shopify_event=%s",
            shipment.id,
            current_status,
            shopify_event_status,
        )
    except Exception as exc:  # noqa: BLE001
        # Don't fail the whole sync just because the event push failed
        logger.warning(
            "Shopify status event push failed shipment_id=%s status=%s error=%s",
            shipment.id,
            current_status,
            exc,
        )


def _extract_open_fulfillment_order_ids(snapshot: object) -> list[str]:
    if not isinstance(snapshot, list):
        return []

    # INCOMPLETE = partially fulfilled; remaining items can still receive new fulfillments.
    # Only CANCELLED and CLOSED are truly terminal — do not include INCOMPLETE here.
    blocked_statuses = {"CANCELLED", "CLOSED"}
    fulfillment_order_ids: list[str] = []
    for row in snapshot:
        if not isinstance(row, dict):
            continue
        fulfillment_order_id = _clean_text(row.get("id"))
        status = _clean_text(row.get("status"))
        if not fulfillment_order_id:
            continue
        if status and status.upper() in blocked_statuses:
            continue
        fulfillment_order_ids.append(fulfillment_order_id)
    return fulfillment_order_ids


def _extract_tracking_info_nodes(payload: object) -> list[dict]:
    if isinstance(payload, dict):
        return [node for node in (payload.get("nodes") or []) if isinstance(node, dict)]
    if isinstance(payload, list):
        return [node for node in payload if isinstance(node, dict)]
    return []


def _raise_on_shopify_user_errors(user_errors: list[dict]) -> None:
    meaningful_errors = [error for error in user_errors if isinstance(error, dict) and _clean_text(error.get("message"))]
    if not meaningful_errors:
        return
    message = "; ".join(_clean_text(error.get("message")) or "Unknown Shopify user error" for error in meaningful_errors)
    raise ShopifyFulfillmentSyncError(message)


def import_shopify_orders(
    db: Session,
    integration: ShopIntegration,
    create_missing_orders: bool = True,
    updated_since: datetime | None = None,
    max_orders: int | None = None,
    access_token: str | None = None,
    source: str = "shopify_sync",
    custom_query: str | None = None,
) -> ShopifyImportResult:
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
        total_fetched=0,
    )

    for shopify_order in _iter_recent_orders(
        shop_domain=integration.shop_domain,
        access_token=access_token or integration.access_token,
        first=max_orders,
        updated_since=updated_since,
        custom_query=custom_query,
    ):
        result.total_fetched += 1
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
            existing_order.shipping_name = shopify_order.shipping_name or customer_name
            existing_order.shipping_phone = shopify_order.shipping_phone or shopify_order.customer_phone
            existing_order.shipping_country_code = shopify_order.shipping_country_code
            existing_order.shipping_postal_code = shopify_order.shipping_postal_code
            existing_order.shipping_address_line1 = shopify_order.shipping_address_line1
            existing_order.shipping_address_line2 = shopify_order.shipping_address_line2
            existing_order.shipping_town = shopify_order.shipping_town
            existing_order.shipping_province_code = shopify_order.shipping_province_code
            existing_order.shopify_shipping_snapshot_json = build_shopify_shipping_snapshot(shopify_order)
            existing_order.shopify_shipping_rate_name = shopify_order.shipping_rate_name
            existing_order.shopify_shipping_rate_amount = shopify_order.shipping_rate_amount
            existing_order.shopify_shipping_rate_currency = shopify_order.shipping_rate_currency
            existing_order.note = shopify_order.note
            existing_order.tags_json = shopify_order.tags or None
            existing_order.channel = shopify_order.source_name
            existing_order.shopify_financial_status = shopify_order.display_financial_status
            existing_order.shopify_fulfillment_status = shopify_order.display_fulfillment_status
            existing_order.cancelled_at = parse_shopify_datetime(shopify_order.cancelled_at)
            existing_order.cancel_reason = shopify_order.cancel_reason
            existing_order.fulfillment_orders_json = shopify_order.fulfillment_orders or None
            sync_order_items_from_shopify(existing_order, shopify_order)
            existing_order.is_personalized = infer_order_is_personalized(existing_order.items)

            shipment_sync = sync_tracking_from_shopify(existing_order, shopify_order)
            if shipment_sync.shipment_created:
                result.shipments_created_count += 1
            if shipment_sync.shipment_updated:
                result.shipments_updated_count += 1
            result.tracking_events_created_count += shipment_sync.tracking_events_created_count
            incidents_before = len(existing_order.incidents)
            evaluate_order_automation_rules(db=db, order=existing_order, source=source, skip_url_checks=True)
            result.incidents_created_count += max(len(existing_order.incidents) - incidents_before, 0)
            result.updated_count += 1
            logger.info(
                "Shopify order mapped order_id=%s external_id=%s shipping_snapshot=%s",
                existing_order.id,
                existing_order.external_id,
                existing_order.shopify_shipping_snapshot_json,
            )
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
            "shipping_name": shopify_order.shipping_name or customer_name,
            "shipping_phone": shopify_order.shipping_phone or shopify_order.customer_phone,
            "shipping_country_code": shopify_order.shipping_country_code,
            "shipping_postal_code": shopify_order.shipping_postal_code,
            "shipping_address_line1": shopify_order.shipping_address_line1,
            "shipping_address_line2": shopify_order.shipping_address_line2,
            "shipping_town": shopify_order.shipping_town,
            "shipping_province_code": shopify_order.shipping_province_code,
            "shopify_shipping_snapshot_json": build_shopify_shipping_snapshot(shopify_order),
            "shopify_shipping_rate_name": shopify_order.shipping_rate_name,
            "shopify_shipping_rate_amount": shopify_order.shipping_rate_amount,
            "shopify_shipping_rate_currency": shopify_order.shipping_rate_currency,
            "note": shopify_order.note,
            "tags_json": shopify_order.tags or None,
            "channel": shopify_order.source_name,
            "shopify_financial_status": shopify_order.display_financial_status,
            "shopify_fulfillment_status": shopify_order.display_fulfillment_status,
            "cancelled_at": parse_shopify_datetime(shopify_order.cancelled_at),
            "cancel_reason": shopify_order.cancel_reason,
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
        logger.info(
            "Shopify order imported external_id=%s shipping_snapshot=%s",
            external_id,
            order_data["shopify_shipping_snapshot_json"],
        )
        order.items = imported_items

        shipment_sync = sync_tracking_from_shopify(order, shopify_order)
        if shipment_sync.shipment_created:
            result.shipments_created_count += 1
        if shipment_sync.shipment_updated:
            result.shipments_updated_count += 1
        result.tracking_events_created_count += shipment_sync.tracking_events_created_count
        incidents_before = len(order.incidents)
        evaluate_order_automation_rules(db=db, order=order, source=source, skip_url_checks=True)
        result.incidents_created_count += max(len(order.incidents) - incidents_before, 0)

        db.add(order)
        result.imported_count += 1

        # Commit and expunge every _IMPORT_BATCH_SIZE orders so SQLAlchemy's
        # identity map doesn't grow unbounded on large syncs.  After expunge_all
        # the next find_existing_order() will re-query from the freshly committed
        # state, which is safe because every processed order is already flushed.
        if result.total_fetched % _IMPORT_BATCH_SIZE == 0:
            db.commit()
            db.expunge_all()

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


def _parse_shopify_order_number(name: str) -> int | None:
    """Extract the integer order number from a Shopify order name like '#13599'."""
    stripped = name.lstrip("#").strip()
    try:
        return int(stripped)
    except (ValueError, AttributeError):
        return None


def fill_shopify_order_gaps(
    db: Session,
    integration: ShopIntegration,
    access_token: str,
    lookback_days: int = 14,
    max_gap_fill: int = 200,
) -> int:
    """
    Detects numeric gaps in locally stored Shopify order numbers and fetches the
    missing ones directly from Shopify by name filter.

    This runs after each incremental sync cycle so that orders whose updated_at
    fell just outside the safety-overlap window are still recovered without
    needing a full re-import.

    Returns the number of orders successfully filled.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    rows = (
        db.execute(
            select(Order.external_id, Order.shopify_order_name).where(
                Order.shop_id == integration.shop_id,
                Order.created_at >= cutoff,
            )
        )
        .all()
    )

    local_numbers: set[int] = set()
    for row in rows:
        for candidate in (row.shopify_order_name, row.external_id):
            num = _parse_shopify_order_number(candidate or "")
            if num:
                local_numbers.add(num)
                break

    if not local_numbers:
        return 0

    min_num = min(local_numbers)
    max_num = max(local_numbers)
    gaps = sorted(set(range(min_num, max_num + 1)) - local_numbers)

    if not gaps:
        return 0

    # Prioritise the most recent gaps: those are what operators see on page 1
    # and they're the ones that matter for SLAs. Older gaps drain over
    # subsequent cycles. Without this, a pile of old/cancelled-order gaps
    # would consume the budget and leave recent gaps unfilled.
    total_gap_count = len(gaps)
    gaps = gaps[-max_gap_fill:]
    gaps.sort(reverse=True)
    logger.info(
        "Gap fill: shop_id=%s found %d missing order(s) in range #%d–#%d, processing %d newest: %s",
        integration.shop_id,
        total_gap_count,
        min_num,
        max_num,
        len(gaps),
        gaps[:20],
    )

    filled = 0
    _GAP_BATCH = 10
    for i in range(0, len(gaps), _GAP_BATCH):
        batch = gaps[i : i + _GAP_BATCH]
        query_filter = " OR ".join(f"name:#{n}" for n in batch)
        gap_result = import_shopify_orders(
            db=db,
            integration=integration,
            create_missing_orders=True,
            max_orders=_GAP_BATCH,
            access_token=access_token,
            source="gap_fill",
            custom_query=query_filter,
        )
        filled += gap_result.imported_count
        logger.info(
            "Gap fill batch shop_id=%s: fetched=%d imported=%d skipped=%d",
            integration.shop_id,
            gap_result.total_fetched,
            gap_result.imported_count,
            gap_result.skipped_count,
        )

    return filled


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
        settings = get_settings()
        # Full imports can be large by design. Incremental syncs are capped lower by default
        # to avoid memory spikes on small instances.
        max_orders = (
            settings.shopify_sync_max_orders
            if full_sync
            else settings.shopify_incremental_sync_max_orders
        )
        # full_sync=True (manual import from settings) → no date filter, fetch all history.
        # full_sync=False (scheduler / incremental) → cap at 3 months so we never pull
        # older orders unless explicitly requested.
        #
        # Safety overlap: each incremental sync goes back an extra 30 minutes relative
        # to last_synced_at. This catches orders that fell beyond the page cap in the
        # previous cycle (their updated_at is within the overlap window).
        # 30-min overlap catches orders that slipped past the previous cycle's cap
        # without re-fetching excessive history on every run.
        INCREMENTAL_SAFETY_OVERLAP = timedelta(minutes=30)
        if full_sync:
            updated_since = None
        else:
            cutoff = datetime.now(timezone.utc) - timedelta(days=90)
            if integration.last_synced_at:
                last_sync = integration.last_synced_at.astimezone(timezone.utc)
                safe_since = last_sync - INCREMENTAL_SAFETY_OVERLAP
                updated_since = safe_since if safe_since > cutoff else cutoff
            else:
                updated_since = cutoff
        result = import_shopify_orders(
            db=db,
            integration=integration,
            create_missing_orders=create_missing_orders,
            updated_since=updated_since,
            max_orders=max_orders,
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
        # Gap fill: on incremental syncs, detect and recover numeric gaps in the
        # order-number sequence that the updated_at filter may have missed.
        gap_filled_count = 0
        if not full_sync:
            try:
                gap_filled_count = fill_shopify_order_gaps(
                    db=db,
                    integration=integration,
                    access_token=access_token,
                )
                result.imported_count += gap_filled_count
            except Exception as exc:
                logger.warning(
                    "Gap fill skipped for shop_id=%s: %s",
                    integration.shop_id,
                    exc,
                )

        should_run_backfill = full_sync or source in {"manual_import", "manual_validation", "backfill"}
        backfilled_variant_orders_count = 0
        if should_run_backfill:
            try:
                # Cap backfill at 200 orders per cycle regardless of the full-sync
                # limit to avoid loading thousands of ORM objects at once.
                backfill_cap = min(get_settings().shopify_sync_max_orders, 200)
                backfilled_variant_orders_count = backfill_missing_shopify_order_links(
                    db=db,
                    integration=integration,
                    max_orders=backfill_cap,
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
            "gap_filled_count": gap_filled_count,
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


def _sync_product_variants(
    *,
    db: Session,
    product: "ShopCatalogProduct",
    variants: "list[ShopifyCatalogVariantPayload]",
    existing_variants: "dict[str, ShopCatalogVariant]",
    now: datetime,
) -> None:
    """Upsert ShopCatalogVariant rows for a single product."""
    incoming_ids: set[str] = set()
    for variant in variants:
        vid = variant.external_variant_id
        if not vid:
            continue
        incoming_ids.add(vid)
        existing = existing_variants.get(vid)
        if existing is None:
            new_variant = ShopCatalogVariant(
                shop_id=product.shop_id,
                product_id=product.id,
                provider=product.provider,
                external_product_id=product.external_product_id,
                external_variant_id=vid,
                sku=variant.sku,
                title=variant.title,
                option_values_json=variant.option_values,
                external_created_at=variant.created_at,
                external_updated_at=variant.updated_at,
                synced_at=now,
            )
            db.add(new_variant)
            existing_variants[vid] = new_variant
        else:
            existing.sku = variant.sku
            existing.title = variant.title
            existing.option_values_json = variant.option_values
            existing.external_updated_at = variant.updated_at
            existing.synced_at = now

    # Remove variants that have been deleted from Shopify for this product
    for variant in list(product.variants):
        if variant.external_variant_id not in incoming_ids:
            db.delete(variant)
            existing_variants.pop(variant.external_variant_id, None)


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
        shopify_sync_status="synced",
        shopify_synced_at=datetime.now(timezone.utc),
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
                source="shopify",
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

    if shipment.shopify_sync_status != "synced":
        shipment.shopify_sync_status = "synced"
        shipment.shopify_sync_error = None
        shipment.shopify_synced_at = datetime.now(timezone.utc)
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
    shipping_address = node.get("shippingAddress") or {}
    shipping_lines = ((node.get("shippingLines") or {}).get("nodes") or [])
    raw_fulfillments = node.get("fulfillments", [])
    fulfillment_nodes = raw_fulfillments.get("nodes", []) if isinstance(raw_fulfillments, dict) else (raw_fulfillments or [])
    raw_fulfillment_orders = node.get("fulfillmentOrders", {})
    fulfillment_order_nodes = raw_fulfillment_orders.get("nodes", []) if isinstance(raw_fulfillment_orders, dict) else (raw_fulfillment_orders or [])
    line_item_nodes = node.get("lineItems", {}).get("nodes", [])
    order_custom_attributes = _map_attributes(node.get("customAttributes") or [])

    refunded_by_line_item: dict[str, int] = _aggregate_refunded_quantities(node.get("refunds") or [])

    fulfillments = [_map_fulfillment(fulfillment_node) for fulfillment_node in fulfillment_nodes]
    tracking_info = _first_tracking_info(fulfillments)
    latest_tracking_event = _latest_tracking_event(fulfillments)
    primary_shipping_line = shipping_lines[0] if shipping_lines else {}
    primary_shop_money = (((primary_shipping_line.get("originalPriceSet") or {}).get("shopMoney")) or {})

    return ShopifyOrder(
        id=str(node.get("id", "")),
        name=str(node.get("name", "")),
        source_name=_clean_text(node.get("sourceName")),
        display_financial_status=node.get("displayFinancialStatus"),
        display_fulfillment_status=node.get("displayFulfillmentStatus"),
        cancelled_at=node.get("cancelledAt"),
        cancel_reason=_clean_text(node.get("cancelReason")),
        created_at=str(node.get("createdAt", "")),
        note=node.get("note"),
        tags=[tag for tag in (node.get("tags") or []) if isinstance(tag, str) and tag.strip()],
        customer_id=_clean_text(customer.get("id")),
        customer_first_name=customer.get("firstName"),
        customer_last_name=customer.get("lastName"),
        customer_email=customer.get("email"),
        customer_phone=_clean_text(customer.get("phone")),
        shipping_first_name=_clean_text(shipping_address.get("firstName")),
        shipping_last_name=_clean_text(shipping_address.get("lastName")),
        shipping_name=_clean_text(shipping_address.get("name")),
        shipping_company=_clean_text(shipping_address.get("company")),
        shipping_phone=_clean_text(shipping_address.get("phone")),
        shipping_country=_clean_text(shipping_address.get("country")),
        shipping_country_code=_clean_text(shipping_address.get("countryCodeV2")),
        shipping_postal_code=_clean_text(shipping_address.get("zip")),
        shipping_address_line1=_clean_text(shipping_address.get("address1")),
        shipping_address_line2=_clean_text(shipping_address.get("address2")),
        shipping_town=_clean_text(shipping_address.get("city")),
        shipping_province=_clean_text(shipping_address.get("province")),
        shipping_province_code=_clean_text(shipping_address.get("provinceCode")),
        shipping_rate_name=_clean_text(primary_shipping_line.get("title")),
        shipping_rate_amount=_safe_float(primary_shop_money.get("amount")),
        shipping_rate_currency=_clean_text(primary_shop_money.get("currencyCode")),
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
            _map_line_item(
                item_node,
                node.get("note"),
                order_custom_attributes,
                refunded_by_line_item,
            )
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


def _aggregate_refunded_quantities(refund_nodes: list[dict] | dict) -> dict[str, int]:
    """Sum refunded quantities per line-item GID across all refunds on an order.

    The Shopify GraphQL shape for `refunds` is a list (not a connection) whose
    entries contain a `refundLineItems.nodes` array.  Each entry has a
    `quantity` and a `lineItem.id` (the original line-item GID).  A single
    line item can appear in multiple refunds (partial refunds), so we sum.
    """
    aggregated: dict[str, int] = {}
    if isinstance(refund_nodes, dict):
        refund_nodes = refund_nodes.get("nodes") or refund_nodes.get("edges") or []
    for refund in refund_nodes or []:
        if not isinstance(refund, dict):
            continue
        refund_line_items = refund.get("refundLineItems") or {}
        if isinstance(refund_line_items, dict):
            entries = refund_line_items.get("nodes") or refund_line_items.get("edges") or []
        else:
            entries = refund_line_items or []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            line_item = entry.get("lineItem") or {}
            gid = _clean_text(line_item.get("id"))
            if not gid:
                continue
            try:
                qty = int(entry.get("quantity", 0) or 0)
            except (TypeError, ValueError):
                qty = 0
            if qty <= 0:
                continue
            aggregated[gid] = aggregated.get(gid, 0) + qty
    return aggregated


def _map_line_item(
    item_node: dict,
    order_note: str | None,
    order_custom_attributes: dict[str, str],
    refunded_by_line_item: dict[str, int] | None = None,
) -> ShopifyLineItem:
    item_attributes = _map_attributes(item_node.get("customAttributes") or [])
    design_link = _extract_design_link(item_attributes, order_custom_attributes)
    line_item_gid = _clean_text(item_node.get("id"))
    refunded_quantity = 0
    if refunded_by_line_item and line_item_gid:
        refunded_quantity = refunded_by_line_item.get(line_item_gid, 0)

    return ShopifyLineItem(
        id=line_item_gid,
        title=_clean_text(item_node.get("title")) or _clean_text(item_node.get("name")) or "",
        sku=str(item_node.get("sku", "")),
        quantity=int(item_node.get("quantity", 0)),
        refunded_quantity=refunded_quantity,
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


def _safe_float(value: object | None) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_attribute_key(value: str) -> str:
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def _find_attribute_value(attributes: dict[str, str], candidate_keys: set[str]) -> str | None:
    for key, value in attributes.items():
        if _normalize_attribute_key(key) in candidate_keys and value.strip():
            return value.strip()
    return None


def _find_attribute_value_in_order(attributes: dict[str, str], candidate_keys: tuple[str, ...]) -> str | None:
    normalized_attributes = {
        _normalize_attribute_key(key): value.strip()
        for key, value in attributes.items()
        if value.strip()
    }
    for key in candidate_keys:
        candidate = normalized_attributes.get(key)
        if candidate:
            return candidate
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
    ordered_keys = (
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
    )
    fallback_http_ignore_keys = {
        "_customization_image",
        "customization_image",
        "_preview_image",
        "preview_image",
        "_image",
        "image",
    }

    for source in (line_item_attributes, order_attributes):
        candidate = _find_attribute_value_in_order(source, ordered_keys)
        if candidate:
            return candidate

        for key, value in source.items():
            normalized = value.strip()
            normalized_key = _normalize_attribute_key(key)
            if normalized_key in fallback_http_ignore_keys:
                continue
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
        parsed_cancelled_at = parse_shopify_datetime(shopify_order.cancelled_at)
        if parsed_cancelled_at is not None:
            order.cancelled_at = parsed_cancelled_at
            order.cancel_reason = shopify_order.cancel_reason or order.cancel_reason
            if order.status != OrderStatus.cancelled:
                order.status = OrderStatus.cancelled
        order.fulfillment_orders_json = shopify_order.fulfillment_orders or order.fulfillment_orders_json

        sync_order_items_from_shopify(order, shopify_order)
        order.is_personalized = infer_order_is_personalized(order.items)
        sync_tracking_from_shopify(order, shopify_order)

        after = _snapshot_order_item_links(order)
        after_tracking = _snapshot_order_tracking(order)
        if before != after or before_order_gid != order.shopify_order_gid or before_tracking != after_tracking:
            updated_orders_count += 1

        # Commit after each backfilled order to avoid accumulating a large
        # dirty session; expunge_all releases the identity-map cache.
        db.commit()
        db.expunge_all()

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
        refunded_quantity=max(int(line_item.refunded_quantity or 0), 0),
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
        item.refunded_quantity = max(int(line_item.refunded_quantity or 0), 0)
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
