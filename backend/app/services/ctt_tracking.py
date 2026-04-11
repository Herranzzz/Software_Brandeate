from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Order, Shipment, TrackingEvent
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.ctt import CTTError, get_tracking, get_trackings_by_date
from app.services.orders import sync_order_status_from_tracking
from app.services.shopify import push_pending_shipment_status_event, sync_shipment_tracking_to_shopify


logger = logging.getLogger(__name__)


TERMINAL_STATUSES = {"delivered"}


@dataclass(frozen=True)
class ParsedTrackingEvent:
    normalized_status: str
    raw_status: str
    occurred_at: datetime
    location: str | None
    payload: dict[str, Any]


@dataclass(frozen=True)
class ShipmentTrackingSyncResult:
    shipment_id: int
    tracking_number: str
    changed: bool
    events_created: int
    latest_status: str | None
    latest_raw_status: str | None
    shopify_sync_status: str | None
    ctt_payload: dict[str, Any] | None


def sync_shipment_tracking(
    *,
    db: Session,
    shipment: Shipment,
    push_to_shopify: bool = True,
) -> ShipmentTrackingSyncResult:
    tracking_number = (shipment.tracking_number or "").strip()
    if not tracking_number:
        raise ValueError("Shipment has no tracking number")

    logger.info("CTT tracking sync start shipment_id=%s tracking=%s", shipment.id, tracking_number)
    payload = _resolve_tracking_payload(shipment)
    parsed_events = extract_tracking_events(payload)
    logger.info(
        "CTT tracking payload shipment_id=%s tracking=%s parsed_events=%s",
        shipment.id,
        tracking_number,
        len(parsed_events),
    )

    latest_before = (shipment.shipping_status or "").strip() or None
    events_created = 0
    changed = False

    for event in reversed(parsed_events):
        if _tracking_event_exists(shipment, event):
            continue
        shipment.events.append(
            TrackingEvent(
                status_norm=event.normalized_status,
                status_raw=event.raw_status,
                source="ctt",
                location=event.location,
                payload_json=event.payload,
                occurred_at=event.occurred_at,
            )
        )
        events_created += 1

    latest_event = parsed_events[0] if parsed_events else _fallback_latest_event(payload)
    if latest_event is not None:
        next_status = latest_event.normalized_status
        next_detail = latest_event.raw_status
        if shipment.shipping_status != next_status:
            shipment.shipping_status = next_status
            changed = True
        if shipment.shipping_status_detail != next_detail:
            shipment.shipping_status_detail = next_detail
            changed = True

        existing_payload = shipment.provider_payload_json if isinstance(shipment.provider_payload_json, dict) else {}
        shipment.provider_payload_json = {
            **existing_payload,
            "latest_tracking_sync": {
                "source": "ctt",
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "tracking_number": tracking_number,
                "latest_status": next_status,
                "latest_raw_status": next_detail,
                "latest_location": latest_event.location,
                "events_seen": len(parsed_events),
                "payload": payload,
            },
        }
        sync_order_status_from_tracking(shipment.order, next_status)

    if events_created > 0:
        changed = True

    shopify_sync_status: str | None = None
    if push_to_shopify:
        if changed:
            # Tracking changed → full sync (creates/updates fulfillment in Shopify)
            shopify_sync_status = sync_shipment_tracking_to_shopify(
                db=db,
                order=shipment.order,
                shipment=shipment,
                notify_customer=False,  # initial creation auto-notifies; updates do not
                force=True,
            )
            # Fallback: if the full sync failed but we already have a fulfillment_id,
            # still try to push the pending status event independently.
            # sync_shipment_tracking_to_shopify calls this on success (no-op there),
            # but on failure it returns early without calling it.
            if (shipment.fulfillment_id or "").strip():
                push_pending_shipment_status_event(db=db, order=shipment.order, shipment=shipment)
        elif (shipment.fulfillment_id or "").strip():
            # Nothing changed but there may be a pending status event to push
            # (e.g. app was redeployed and shopify_status_event_pushed was reset)
            push_pending_shipment_status_event(db=db, order=shipment.order, shipment=shipment)
            shopify_sync_status = shipment.shopify_sync_status

    evaluate_order_automation_rules(db=db, order=shipment.order, source="ctt_tracking_sync", skip_url_checks=True)
    logger.info(
        "CTT tracking sync end shipment_id=%s tracking=%s previous_status=%s latest_status=%s changed=%s events_created=%s shopify_sync_status=%s",
        shipment.id,
        tracking_number,
        latest_before,
        latest_event.normalized_status if latest_event else None,
        changed,
        events_created,
        shopify_sync_status,
    )

    return ShipmentTrackingSyncResult(
        shipment_id=shipment.id,
        tracking_number=tracking_number,
        changed=changed,
        events_created=events_created,
        latest_status=latest_event.normalized_status if latest_event else shipment.shipping_status,
        latest_raw_status=latest_event.raw_status if latest_event else shipment.shipping_status_detail,
        shopify_sync_status=shopify_sync_status,
        ctt_payload=payload,
    )


def _resolve_tracking_payload(shipment: Shipment) -> dict[str, Any]:
    tracking_number = (shipment.tracking_number or "").strip()
    try:
        return get_tracking(tracking_number)
    except CTTError as primary_error:
        fallback_payload = _resolve_tracking_payload_by_date(shipment)
        if fallback_payload is not None:
            logger.info(
                "CTT tracking fallback by date matched shipment_id=%s tracking=%s",
                shipment.id,
                tracking_number,
            )
            return fallback_payload
        raise primary_error


def _resolve_tracking_payload_by_date(shipment: Shipment) -> dict[str, Any] | None:
    shipping_date = (
        shipment.label_created_at
        or shipment.created_at
        or shipment.order.created_at
    )
    if shipping_date is None:
        return None

    from app.core.config import get_settings

    client_center_code = (get_settings().ctt_client_center_code or "").strip()
    if not client_center_code:
        return None

    payload = get_trackings_by_date(
        shipping_date=shipping_date.date().isoformat(),
        client_center_code=client_center_code,
    )
    matched = _find_tracking_payload(payload, (shipment.tracking_number or "").strip())
    return matched or payload


def sync_ctt_tracking_for_active_shipments(
    *,
    db: Session,
    limit: int = 100,
    shop_id: int | None = None,
    log_failures: bool = True,
    before_shipment_id: int | None = None,
) -> list[ShipmentTrackingSyncResult]:
    stmt = (
        select(Shipment)
        .join(Shipment.order)
        .options(
            selectinload(Shipment.events),
            selectinload(Shipment.order),
        )
        .where(Shipment.carrier.ilike("%ctt%"))
        .where(Shipment.tracking_number != "")
        .order_by(Shipment.id.desc())
        .limit(limit)
    )
    if shop_id is not None:
        stmt = stmt.where(Order.shop_id == shop_id)
    if before_shipment_id is not None:
        stmt = stmt.where(Shipment.id < before_shipment_id)

    shipments = list(db.scalars(stmt))
    results: list[ShipmentTrackingSyncResult] = []
    for shipment in shipments:
        if (shipment.shipping_status or "").strip() in TERMINAL_STATUSES:
            continue
        try:
            results.append(sync_shipment_tracking(db=db, shipment=shipment))
        except CTTError as exc:
            if log_failures:
                logger.warning(
                    "CTT tracking sync skipped shipment_id=%s tracking=%s reason=%s",
                    shipment.id,
                    shipment.tracking_number,
                    exc,
                )
            else:
                logger.debug(
                    "CTT tracking sync skipped shipment_id=%s tracking=%s reason=%s",
                    shipment.id,
                    shipment.tracking_number,
                    exc,
                )
        except Exception:
            logger.exception("Unexpected tracking sync failure shipment_id=%s tracking=%s", shipment.id, shipment.tracking_number)
    return results


def sync_all_ctt_tracking_for_active_shipments(
    *,
    db: Session,
    batch_size: int = 100,
    shop_id: int | None = None,
    log_failures: bool = True,
) -> list[ShipmentTrackingSyncResult]:
    results: list[ShipmentTrackingSyncResult] = []
    cursor: int | None = None
    safe_batch_size = max(1, min(batch_size, 500))

    while True:
        stmt = (
            select(Shipment.id)
            .join(Shipment.order)
            .where(Shipment.carrier.ilike("%ctt%"))
            .where(Shipment.tracking_number != "")
            .order_by(Shipment.id.desc())
            .limit(safe_batch_size)
        )
        if shop_id is not None:
            stmt = stmt.where(Order.shop_id == shop_id)
        if cursor is not None:
            stmt = stmt.where(Shipment.id < cursor)

        batch_ids = list(db.scalars(stmt))
        if not batch_ids:
            break

        batch_results = sync_ctt_tracking_for_active_shipments(
            db=db,
            limit=safe_batch_size,
            shop_id=shop_id,
            log_failures=log_failures,
            before_shipment_id=cursor,
        )
        results.extend(batch_results)
        cursor = min(batch_ids)

        if len(batch_ids) < safe_batch_size:
            break

    return results


def map_ctt_tracking_status(raw_status: str | None) -> str:
    status = (raw_status or "").strip().lower()
    if not status:
        return "in_transit"

    if any(token in status for token in ("entregado", "delivered", "entregue", "delivery completed")):
        return "delivered"
    if any(token in status for token in ("en reparto", "out for delivery", "reparto", "delivery route", "em distribuição")):
        return "out_for_delivery"
    if any(token in status for token in ("no recogido", "not collected", "failed pickup")):
        return "exception"
    if any(
        token in status
        for token in (
            "recogido por",
            "paquete recogido",
            "picked up by",
            "collected by",
            "accepted by carrier",
            "aceptado por el transportista",
            "admitido en delegación",
            "admitido por ctt",
            "admitted by ctt",
            "colis pris en charge",
            "recolhido",
        )
    ):
        return "picked_up"
    if any(
        token in status
        for token in (
            "disponible para recoger",
            "disponible para su recogida",
            "listo para recoger",
            "available for pickup",
            "ready for pickup",
            "pickup point",
            "parcel shop",
            "parcelshop",
        )
    ):
        return "pickup_available"
    if any(token in status for token in ("incidencia", "exception", "failed", "attempt", "devuelto", "returned", "refused", "address", "impossib", "unable")):
        return "exception"
    if any(token in status for token in ("prealert", "pre-alert", "label created", "manifestado", "grabado", "información recibida", "shipment data", "created")):
        return "label_created"
    if any(token in status for token in ("transit", "tránsito", "transito", "sorting", "clasificado", "hub", "linehaul", "route", "encaminado", "in distribution")):
        return "in_transit"
    return "in_transit"


def extract_tracking_events(payload: dict[str, Any]) -> list[ParsedTrackingEvent]:
    candidates = _collect_event_candidates(payload)
    events: list[ParsedTrackingEvent] = []
    seen: set[tuple[str, datetime]] = set()
    for candidate in candidates:
        raw_status = _extract_status_text(candidate)
        occurred_at = _extract_event_datetime(candidate)
        if not raw_status or occurred_at is None:
            continue
        normalized_status = map_ctt_tracking_status(raw_status)
        key = (normalized_status, occurred_at)
        if key in seen:
            continue
        seen.add(key)
        events.append(
            ParsedTrackingEvent(
                normalized_status=normalized_status,
                raw_status=raw_status,
                occurred_at=occurred_at,
                location=_extract_location(candidate),
                payload=_truncate_payload(candidate),
            )
        )
    events.sort(key=lambda item: (item.occurred_at, item.raw_status), reverse=True)
    return events


def _fallback_latest_event(payload: dict[str, Any]) -> ParsedTrackingEvent | None:
    raw_status = _extract_status_text(payload)
    occurred_at = _extract_event_datetime(payload) or datetime.now(timezone.utc)
    if not raw_status:
        return None
    return ParsedTrackingEvent(
        normalized_status=map_ctt_tracking_status(raw_status),
        raw_status=raw_status,
        occurred_at=occurred_at,
        location=_extract_location(payload),
        payload=_truncate_payload(payload),
    )


def _collect_event_candidates(value: Any) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if _looks_like_tracking_event(value):
            candidates.append(value)
        for nested in value.values():
            candidates.extend(_collect_event_candidates(nested))
    elif isinstance(value, list):
        for item in value:
            candidates.extend(_collect_event_candidates(item))
    return candidates


def _find_tracking_payload(value: Any, tracking_number: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if _dict_matches_tracking(value, tracking_number):
            return value
        for nested in value.values():
            matched = _find_tracking_payload(nested, tracking_number)
            if matched is not None:
                return matched
    elif isinstance(value, list):
        for item in value:
            matched = _find_tracking_payload(item, tracking_number)
            if matched is not None:
                return matched
    return None


def _dict_matches_tracking(value: dict[str, Any], tracking_number: str) -> bool:
    if not tracking_number:
        return False
    normalized = tracking_number.strip()
    for key in (
        "shipping_code",
        "shippingCode",
        "tracking_number",
        "trackingNumber",
        "item_code",
        "itemCode",
        "barcode",
        "bar_code",
        "shipping_reference",
    ):
        candidate = value.get(key)
        if isinstance(candidate, str):
            if candidate.strip() == normalized or candidate.strip().endswith(normalized):
                return True
    return False


def _looks_like_tracking_event(value: dict[str, Any]) -> bool:
    return bool(_extract_status_text(value)) and _extract_event_datetime(value) is not None


def _extract_status_text(value: dict[str, Any] | None) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in (
        "status_desc",
        "status_description",
        "statusDescription",
        "status",
        "description",
        "desc",
        "event_description",
        "eventDescription",
        "event",
        "state",
        "state_desc",
        "situation",
        "tracking_status",
        "last_status",
        "name",
        "title",
    ):
        text = value.get(key)
        if isinstance(text, str) and text.strip():
            return text.strip()
    return None


def _extract_event_datetime(value: dict[str, Any] | None) -> datetime | None:
    if not isinstance(value, dict):
        return None
    for key in (
        "event_time",
        "event_date",
        "event_datetime",
        "eventDate",
        "eventDatetime",
        "date_time",
        "datetime",
        "occurred_at",
        "created_at",
        "updated_at",
        "date",
        "timestamp",
        "operation_date",
        "operationDate",
        "shipping_date",
        "tracking_date",
    ):
        parsed = _parse_datetime(value.get(key))
        if parsed is not None:
            return parsed
    return None


def _extract_location(value: dict[str, Any] | None) -> str | None:
    if not isinstance(value, dict):
        return None
    direct = []
    for key in (
        "location",
        "delegation_name",
        "delegation",
        "center_name",
        "center",
        "city",
        "town",
        "province",
        "destin_name",
        "destin_province_name",
        "origin_name",
        "origin_province_name",
        "office",
        "station",
    ):
        field = value.get(key)
        if isinstance(field, str) and field.strip():
            direct.append(field.strip())
    if direct:
        return " · ".join(direct[:2])

    for nested_key in ("location_data", "locationData", "center_data", "office_data"):
        nested = value.get(nested_key)
        if isinstance(nested, dict):
            nested_location = _extract_location(nested)
            if nested_location:
                return nested_location
    return None


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if not isinstance(value, str):
        return None

    raw = value.strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y-%m-%d",
    ):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _tracking_event_exists(shipment: Shipment, event: ParsedTrackingEvent) -> bool:
    for existing_event in shipment.events:
        if (
            existing_event.status_norm == event.normalized_status
            and existing_event.occurred_at == event.occurred_at
            and (existing_event.source in {None, "ctt"})
        ):
            return True
    return False


def _truncate_payload(value: dict[str, Any]) -> dict[str, Any]:
    payload = dict(value)
    if len(payload) > 12:
        keys = list(payload.keys())[:12]
        return {key: payload[key] for key in keys}
    return payload
