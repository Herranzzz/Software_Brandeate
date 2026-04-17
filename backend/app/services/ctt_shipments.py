from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Order, ProductionStatus, Shipment, TrackingEvent, User
from app.schemas.ctt import CTTCreateAdhocShippingRequest, CTTCreateShippingRequest
from app.services.automation_rules import evaluate_order_automation_rules
from app.services.ctt import CTTError, create_shipping
from app.services.orders import sync_order_status_from_tracking
from app.services.shipping_rules import resolve_ctt_service
from app.services.shopify import sync_shipment_tracking_to_shopify


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CTTWeightBand:
    code: str
    label: str
    max_weight: float


WEIGHT_BANDS: tuple[CTTWeightBand, ...] = (
    CTTWeightBand("band_1000", "1 kg", 1.0),
    CTTWeightBand("band_2000", "2 kg", 2.0),
    CTTWeightBand("band_3000", "3 kg", 3.0),
    CTTWeightBand("band_4000", "4 kg", 4.0),
    CTTWeightBand("band_5000", "5 kg", 5.0),
    CTTWeightBand("band_10000", "10 kg", 10.0),
    CTTWeightBand("band_15000", "15 kg", 15.0),
)

WEIGHT_BANDS_BY_CODE = {band.code: band for band in WEIGHT_BANDS}


def _add_business_days(from_date: date, days: int) -> date:
    """Return from_date + N business days (Mon–Fri, no holidays)."""
    result = from_date
    added = 0
    while added < days:
        result += timedelta(days=1)
        if result.weekday() < 5:  # Monday=0 .. Friday=4
            added += 1
    return result


# Delivery window (business days) by CTT service code
_CTT_DELIVERY_DAYS: dict[str, int] = {
    "C24": 1,
    "C48": 2,
    "C14": 14,
    "C10": 10,
    "C14E": 2,   # Premium Empresas ≈ 2 days
    "CBA24": 2,  # Baleares Express ≈ 2 days
    "CBA48": 4,  # Baleares Economy ≈ 4 days
}


class CTTShipmentOrchestrationError(Exception):
    pass


class CTTShipmentDuplicateError(CTTShipmentOrchestrationError):
    pass


@dataclass
class CTTAdhocShipmentResult:
    shipping_code: str
    tracking_url: str | None
    ctt_response: dict


def create_adhoc_ctt_shipment(
    *,
    db: Session,
    order: Order,
    payload: CTTCreateAdhocShippingRequest,
    current_user: User | None = None,
) -> CTTAdhocShipmentResult:
    """Create an ADDITIONAL CTT label for an order without replacing its shipment.

    Uses the order for shop shipping settings + recipient defaults, but the
    resulting shipping_code is NOT persisted on Order.shipment. The user just
    downloads/prints the label.
    """
    settings = get_settings()
    shop_shipping_settings = (
        order.shop.shipping_settings_json
        if getattr(order, "shop", None) is not None and isinstance(order.shop.shipping_settings_json, dict)
        else {}
    )
    client_center_code = (
        _shipping_setting(shop_shipping_settings, "ctt_client_center_code")
        or (settings.ctt_client_center_code or "").strip()
        or None
    )
    if not client_center_code:
        raise CTTShipmentOrchestrationError("CTT Express no está configurado (CTT_CLIENT_CENTER_CODE ausente)")

    # Reuse the same resolvers as the regular endpoint — allows the adhoc
    # request to fall back to the order's recipient if any field is blank.
    template = CTTCreateShippingRequest(
        order_id=order.id,
        recipient_name=payload.recipient_name,
        recipient_country_code=payload.recipient_country_code,
        recipient_postal_code=payload.recipient_postal_code,
        recipient_address=payload.recipient_address,
        recipient_town=payload.recipient_town,
        recipient_phones=payload.recipient_phones,
        recipient_email=payload.recipient_email,
        shipping_weight_declared=payload.shipping_weight_declared,
        weight_tier_code=payload.weight_tier_code,
        item_count=payload.item_count,
        shipping_type_code=payload.shipping_type_code,
        shipping_rule_id=payload.shipping_rule_id,
        shipping_date=payload.shipping_date,
    )

    recipient_name = _resolve_recipient_name(order, template, shop_shipping_settings)
    recipient_country_code = _resolve_recipient_country_code(order, template, shop_shipping_settings)
    recipient_postal_code = _resolve_recipient_postal_code(order, template, shop_shipping_settings)
    recipient_town = _resolve_recipient_town(order, template, shop_shipping_settings)
    recipient_address = _resolve_recipient_address(order, template, shop_shipping_settings)
    recipient_phone = _resolve_recipient_phone(order, template, shop_shipping_settings)
    recipient_email = _resolve_recipient_email(order, template, shop_shipping_settings)

    missing_fields: list[str] = []
    if not recipient_name:
        missing_fields.append("destinatario")
    if not recipient_postal_code:
        missing_fields.append("código postal")
    if not recipient_address:
        missing_fields.append("dirección")
    if not recipient_town:
        missing_fields.append("ciudad")
    if not recipient_phone:
        missing_fields.append("teléfono")
    if missing_fields:
        raise CTTShipmentOrchestrationError(
            f"Faltan datos para crear la etiqueta: {', '.join(missing_fields)}"
        )

    weight_band = resolve_weight_band(
        weight_tier_code=payload.weight_tier_code
        or _shipping_setting(shop_shipping_settings, "default_weight_tier_code"),
        shipping_weight_declared=payload.shipping_weight_declared,
    )
    shipping_weight_declared = weight_band.max_weight

    resolved_service = resolve_ctt_service(
        db=db,
        order=order,
        requested_service_code=payload.shipping_type_code,
        requested_rule_id=payload.shipping_rule_id,
        requested_zone=None,
        resolution_mode="manual" if payload.shipping_type_code else "automatic",
        shipping_weight_declared=shipping_weight_declared,
        weight_tier_code=weight_band.code,
    )
    shipping_type_code = (
        resolved_service.carrier_service_code
        or _shipping_setting(shop_shipping_settings, "default_shipping_type_code")
        or settings.ctt_default_shipping_type_code
        or ""
    ).strip()

    item_count = max(int(payload.item_count or 1), 1)
    shipping_date = payload.shipping_date or date.today().isoformat()

    sender_name = _shipping_setting(shop_shipping_settings, "sender_name") or settings.ctt_sender_name
    sender_country_code = (
        _shipping_setting(shop_shipping_settings, "sender_country_code") or settings.ctt_sender_country_code
    )
    sender_postal_code = (
        _shipping_setting(shop_shipping_settings, "sender_postal_code") or settings.ctt_sender_postal_code
    )
    sender_address = _resolve_sender_address(shop_shipping_settings, settings.ctt_sender_address)
    sender_town = _shipping_setting(shop_shipping_settings, "sender_town") or settings.ctt_sender_town
    notify_recipient_email = _resolve_notify_recipient_email(shop_shipping_settings)

    base_reference = _resolve_label_reference(order, shop_shipping_settings)
    suffix = (payload.label_reference_suffix or "ADIC").strip() or "ADIC"
    label_reference = f"{base_reference}-{suffix}"[:35]  # CTT reference len limit

    ctt_payload: dict = {
        "client_bar_code": "",
        "client_center_code": client_center_code,
        "shipping_type_code": shipping_type_code,
        "client_references": [label_reference, ""],
        "shipping_weight_declared": shipping_weight_declared,
        "item_count": item_count,
        "sender_name": sender_name,
        "sender_country_code": sender_country_code,
        "sender_postal_code": sender_postal_code,
        "sender_address": sender_address,
        "sender_town": sender_town,
        "recipient_name": recipient_name,
        "recipient_country_code": recipient_country_code,
        "recipient_postal_code": recipient_postal_code,
        "recipient_address": recipient_address,
        "recipient_town": recipient_town,
        "recipient_phones": [recipient_phone],
        "shipping_date": shipping_date,
        "delivery": {
            "contact_name": recipient_name,
            "comments": f"Pedido {order.external_id} (envío adicional)",
        },
        "items": [{"item_synonym_code": "", "item_weight_declared": shipping_weight_declared}],
    }
    if recipient_email and notify_recipient_email:
        ctt_payload["recipient_email_notify_address"] = recipient_email

    logger.info(
        "CTT adhoc shipment payload prepared order_id=%s external_id=%s recipient=%s service=%s weight_band=%s reference=%s user_id=%s",
        order.id,
        order.external_id,
        recipient_name,
        shipping_type_code,
        weight_band.code,
        label_reference,
        current_user.id if current_user else None,
    )

    try:
        ctt_response = create_shipping(ctt_payload)
    except CTTError as exc:
        raise CTTShipmentOrchestrationError(str(exc)) from exc

    shipping_code = _extract_shipping_code(ctt_response)
    if not shipping_code:
        raise CTTShipmentOrchestrationError("CTT no devolvió un shipping_code válido")

    tracking_url = _extract_tracking_url(ctt_response) or None

    logger.info(
        "CTT adhoc shipment created order_id=%s tracking=%s tracking_url=%s",
        order.id,
        shipping_code,
        tracking_url,
    )

    return CTTAdhocShipmentResult(
        shipping_code=shipping_code,
        tracking_url=tracking_url,
        ctt_response=ctt_response,
    )


@dataclass
class CTTShipmentCreationResult:
    shipping_code: str
    tracking_url: str | None
    shipment: Shipment
    ctt_response: dict
    shopify_sync_status: str


def create_ctt_shipment_for_order(
    *,
    db: Session,
    order: Order,
    payload: CTTCreateShippingRequest,
    current_user: User | None = None,
) -> CTTShipmentCreationResult:
    settings = get_settings()
    shop_shipping_settings = (
        order.shop.shipping_settings_json
        if getattr(order, "shop", None) is not None and isinstance(order.shop.shipping_settings_json, dict)
        else {}
    )
    # client_center_code: shop settings override takes priority over env var
    client_center_code = (
        _shipping_setting(shop_shipping_settings, "ctt_client_center_code")
        or (settings.ctt_client_center_code or "").strip()
        or None
    )
    if not client_center_code:
        raise CTTShipmentOrchestrationError("CTT Express no está configurado (CTT_CLIENT_CENTER_CODE ausente)")

    if order.shipment is not None and (order.shipment.tracking_number or "").strip():
        if (order.shipment.carrier or "").strip().lower().startswith("ctt"):
            _mark_order_prepared(order=order, current_user=current_user)
            shopify_sync_status = sync_shipment_tracking_to_shopify(
                db=db,
                order=order,
                shipment=order.shipment,
                notify_customer=False,
            )
            db.add(order)
            db.flush()
            existing_payload = order.shipment.provider_payload_json if isinstance(order.shipment.provider_payload_json, dict) else {}
            return CTTShipmentCreationResult(
                shipping_code=order.shipment.tracking_number,
                tracking_url=order.shipment.tracking_url,
                shipment=order.shipment,
                ctt_response=existing_payload,
                shopify_sync_status=shopify_sync_status,
            )
        raise CTTShipmentDuplicateError("El pedido ya tiene una expedición creada")

    recipient_name = _resolve_recipient_name(order, payload, shop_shipping_settings)
    recipient_country_code = _resolve_recipient_country_code(order, payload, shop_shipping_settings)
    recipient_postal_code = _resolve_recipient_postal_code(order, payload, shop_shipping_settings)
    recipient_town = _resolve_recipient_town(order, payload, shop_shipping_settings)
    recipient_address = _resolve_recipient_address(order, payload, shop_shipping_settings)
    recipient_phone = _resolve_recipient_phone(order, payload, shop_shipping_settings)
    recipient_email = _resolve_recipient_email(order, payload, shop_shipping_settings)

    missing_fields: list[str] = []
    if not recipient_name:
        missing_fields.append("destinatario")
    if not recipient_postal_code:
        missing_fields.append("código postal")
    if not recipient_address:
        missing_fields.append("dirección")
    if not recipient_town:
        missing_fields.append("ciudad")
    if not recipient_phone:
        missing_fields.append("teléfono")

    if missing_fields:
        missing_text = ", ".join(missing_fields)
        raise CTTShipmentOrchestrationError(f"Faltan datos para crear la etiqueta: {missing_text}")

    weight_band = resolve_weight_band(
        weight_tier_code=payload.weight_tier_code or _shipping_setting(shop_shipping_settings, "default_weight_tier_code"),
        shipping_weight_declared=payload.shipping_weight_declared,
    )
    shipping_weight_declared = weight_band.max_weight
    resolved_service = resolve_ctt_service(
        db=db,
        order=order,
        requested_service_code=payload.shipping_type_code,
        requested_rule_id=payload.shipping_rule_id,
        requested_zone=payload.detected_zone,
        resolution_mode=payload.resolution_mode,
        shipping_weight_declared=shipping_weight_declared,
        weight_tier_code=weight_band.code,
    )
    shipping_type_code = (
        resolved_service.carrier_service_code
        or _shipping_setting(shop_shipping_settings, "default_shipping_type_code")
        or settings.ctt_default_shipping_type_code
        or ""
    ).strip()
    item_count = max(
        int(
            payload.item_count
            or _resolve_default_package_count(order, shop_shipping_settings)
            or 1
        ),
        1,
    )
    shipping_date = payload.shipping_date or date.today().isoformat()
    sender_name = (
        _shipping_setting(shop_shipping_settings, "sender_name")
        or settings.ctt_sender_name
    )
    sender_country_code = (
        _shipping_setting(shop_shipping_settings, "sender_country_code")
        or settings.ctt_sender_country_code
    )
    sender_postal_code = (
        _shipping_setting(shop_shipping_settings, "sender_postal_code")
        or settings.ctt_sender_postal_code
    )
    sender_address = _resolve_sender_address(shop_shipping_settings, settings.ctt_sender_address)
    sender_town = (
        _shipping_setting(shop_shipping_settings, "sender_town")
        or settings.ctt_sender_town
    )
    notify_recipient_email = _resolve_notify_recipient_email(shop_shipping_settings)
    label_reference = _resolve_label_reference(order, shop_shipping_settings)

    items: list[dict]
    if payload.items:
        items = [
            {
                "item_synonym_code": "",
                "item_weight_declared": item.item_weight_declared,
                **({"item_length_declared": item.item_length_declared} if item.item_length_declared else {}),
                **({"item_width_declared": item.item_width_declared} if item.item_width_declared else {}),
                **({"item_height_declared": item.item_height_declared} if item.item_height_declared else {}),
            }
            for item in payload.items
        ]
    else:
        items = [{"item_synonym_code": "", "item_weight_declared": shipping_weight_declared}]

    ctt_payload: dict = {
        "client_bar_code": "",
        "client_center_code": client_center_code,
        "shipping_type_code": shipping_type_code,
        "client_references": [label_reference, ""],
        "shipping_weight_declared": shipping_weight_declared,
        "item_count": item_count,
        "sender_name": sender_name,
        "sender_country_code": sender_country_code,
        "sender_postal_code": sender_postal_code,
        "sender_address": sender_address,
        "sender_town": sender_town,
        "recipient_name": recipient_name,
        "recipient_country_code": recipient_country_code,
        "recipient_postal_code": recipient_postal_code,
        "recipient_address": recipient_address,
        "recipient_town": recipient_town,
        "recipient_phones": [recipient_phone],
        "shipping_date": shipping_date,
        "delivery": {
            "contact_name": recipient_name,
            "comments": f"Pedido {order.external_id}",
        },
        "items": items,
    }
    if recipient_email and notify_recipient_email:
        ctt_payload["recipient_email_notify_address"] = recipient_email

    logger.info(
        "CTT shipment payload prepared order_id=%s external_id=%s sender=%s sender_address=%s sender_postal=%s sender_town=%s recipient=%s address=%s postal=%s town=%s country=%s phone=%s service=%s weight_band=%s package_count=%s reference=%s notify_email=%s shopify_snapshot=%s",
        order.id,
        order.external_id,
        sender_name,
        sender_address,
        sender_postal_code,
        sender_town,
        recipient_name,
        recipient_address,
        recipient_postal_code,
        recipient_town,
        recipient_country_code,
        recipient_phone,
        shipping_type_code,
        weight_band.code,
        item_count,
        label_reference,
        notify_recipient_email,
        order.shopify_shipping_snapshot_json,
    )

    try:
        ctt_response = create_shipping(ctt_payload)
    except CTTError as exc:
        raise CTTShipmentOrchestrationError(str(exc)) from exc

    shipping_code = _extract_shipping_code(ctt_response)
    if not shipping_code:
        raise CTTShipmentOrchestrationError("CTT no devolvió un shipping_code válido")

    tracking_url = _extract_tracking_url(ctt_response) or None
    shipment = order.shipment or Shipment(order_id=order.id, carrier="CTT Express", tracking_number="")
    if current_user is not None and shipment.created_by_employee_id is None:
        shipment.created_by_employee_id = current_user.id
    shipment.carrier = "CTT Express"
    shipment.tracking_number = shipping_code
    shipment.tracking_url = tracking_url
    shipment.shipping_status = "label_created"
    shipment.shipping_status_detail = "Etiqueta creada en CTT"
    shipment.provider_reference = shipping_code
    shipment.shipping_rule_id = resolved_service.shipping_rule_id
    shipment.shipping_rule_name = resolved_service.shipping_rule_name
    shipment.detected_zone = resolved_service.zone_name
    shipment.resolution_mode = (
        "manual"
        if payload.resolution_mode == "manual" and payload.shipping_type_code and payload.shipping_type_code != (resolved_service.carrier_service_code or "")
        else payload.resolution_mode or "automatic"
    )
    shipment.shipping_type_code = shipping_type_code or None
    shipment.weight_tier_code = weight_band.code
    shipment.weight_tier_label = weight_band.label
    shipment.shipping_weight_declared = shipping_weight_declared
    shipment.package_count = item_count
    shipment.provider_payload_json = ctt_response
    shipment.label_created_at = datetime.now(timezone.utc)
    today = shipment.label_created_at.date()
    shipment.expected_ship_date = today
    delivery_days = _CTT_DELIVERY_DAYS.get(shipping_type_code or "C24", 2)
    shipment.expected_delivery_date = _add_business_days(today, delivery_days)
    if order.shipment is None:
        order.shipment = shipment

    if not any(event.status_norm == "label_created" for event in shipment.events):
        shipment.events.append(
            TrackingEvent(
                status_norm="label_created",
                status_raw="ctt:LABEL_CREATED",
                source="ctt",
                payload_json={"shipping_code": shipping_code, "tracking_url": tracking_url},
                occurred_at=shipment.label_created_at,
            )
        )

    _mark_order_prepared(order=order, current_user=current_user)
    sync_order_status_from_tracking(order, "shipment_created")

    shopify_sync_status = sync_shipment_tracking_to_shopify(
        db=db,
        order=order,
        shipment=shipment,
        notify_customer=False,
    )
    if shopify_sync_status == "failed" and shipment.shopify_sync_error:
        logger.warning("Shopify fulfillment sync failed for order_id=%s: %s", order.id, shipment.shopify_sync_error)

    db.add(order)
    db.flush()
    evaluate_order_automation_rules(db=db, order=order, source="ctt_shipment_create")

    logger.info(
        "CTT shipment created order_id=%s shipment_id=%s tracking=%s tracking_url=%s shopify_sync_status=%s",
        order.id,
        shipment.id,
        shipment.tracking_number,
        shipment.tracking_url,
        shopify_sync_status,
    )

    return CTTShipmentCreationResult(
        shipping_code=shipping_code,
        tracking_url=shipment.tracking_url,
        shipment=shipment,
        ctt_response=ctt_response,
        shopify_sync_status=shopify_sync_status,
    )


def _mark_order_prepared(*, order: Order, current_user: User | None) -> None:
    if order.production_status not in {ProductionStatus.packed, ProductionStatus.completed}:
        order.production_status = ProductionStatus.packed
    if order.prepared_at is None:
        order.prepared_at = datetime.now(timezone.utc)
    if current_user is not None and order.prepared_by_employee_id is None:
        order.prepared_by_employee_id = current_user.id


def resolve_weight_band(*, weight_tier_code: str | None, shipping_weight_declared: float | None) -> CTTWeightBand:
    if weight_tier_code and weight_tier_code in WEIGHT_BANDS_BY_CODE:
        return WEIGHT_BANDS_BY_CODE[weight_tier_code]

    if shipping_weight_declared and shipping_weight_declared > 0:
        for band in WEIGHT_BANDS:
            if shipping_weight_declared <= band.max_weight:
                return band
    return WEIGHT_BANDS_BY_CODE["band_2000"]


def _shipping_setting(settings_payload: dict[str, object], key: str) -> str | None:
    value = settings_payload.get(key)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _resolve_sender_address(settings_payload: dict[str, object], fallback: str) -> str:
    parts = [
        _shipping_setting(settings_payload, "sender_address_line1") or "",
        _shipping_setting(settings_payload, "sender_address_line2") or "",
    ]
    address = " ".join(part for part in parts if part).strip()
    return address or fallback


def _resolve_notify_recipient_email(settings_payload: dict[str, object]) -> bool:
    value = settings_payload.get("recipient_email_notifications")
    if isinstance(value, bool):
        return value
    return True


def _resolve_label_reference(order: Order, settings_payload: dict[str, object]) -> str:
    mode = _shipping_setting(settings_payload, "label_reference_mode") or "reference"
    if mode == "shopify_name":
        return order.shopify_order_name or order.external_id
    return order.external_id


def _resolve_default_package_count(order: Order, settings_payload: dict[str, object]) -> int | None:
    strategy = _shipping_setting(settings_payload, "default_package_strategy") or "per_order"
    if strategy == "per_item":
        total_quantity = sum(max(int(item.quantity or 0), 0) for item in order.items)
        return max(total_quantity, 1)

    value = settings_payload.get("default_package_count")
    if isinstance(value, int):
        return max(value, 1)
    return 1


def _first_non_empty(values: list[str]) -> str:
    for value in values:
        normalized = (value or "").strip()
        if normalized:
            return normalized
    return ""


def _resolve_recipient_name(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    return (
        payload.recipient_name
        or order.shipping_name
        or _snapshot_text(snapshot, "name")
        or _snapshot_name(snapshot)
        or order.customer_name
        or ""
    ).strip()


def _resolve_recipient_country_code(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    return (
        payload.recipient_country_code
        or order.shipping_country_code
        or _snapshot_text(snapshot, "country_code")
        or "ES"
    ).strip().upper()


def _resolve_recipient_postal_code(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    return (
        payload.recipient_postal_code
        or order.shipping_postal_code
        or _snapshot_text(snapshot, "zip")
        or ""
    ).strip()


def _resolve_recipient_town(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    return (
        payload.recipient_town
        or order.shipping_town
        or _snapshot_text(snapshot, "city")
        or ""
    ).strip()


def _resolve_recipient_address(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    order_address = _combine_address(
        order.shipping_address_line1 or "",
        order.shipping_address_line2 or "",
    )
    snapshot_address = _combine_address(
        _snapshot_text(snapshot, "address1") or "",
        _snapshot_text(snapshot, "address2") or "",
    )
    return (
        payload.recipient_address
        or order_address
        or snapshot_address
        or ""
    ).strip()


def _resolve_recipient_phone(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str:
    snapshot = _shipping_snapshot(order)
    return (
        _first_non_empty(payload.recipient_phones)
        or (order.shipping_phone or "").strip()
        or _snapshot_text(snapshot, "phone")
        or ""
    ).strip()


def _resolve_recipient_email(order: Order, payload: CTTCreateShippingRequest, settings_payload: dict[str, object]) -> str | None:
    return (
        (payload.recipient_email or "").strip()
        or _snapshot_text(_shipping_snapshot(order), "email")
        or order.customer_email
        or None
    )


def _snapshot_text(snapshot: dict[str, object], key: str) -> str | None:
    value = snapshot.get(key)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _snapshot_name(snapshot: dict[str, object]) -> str | None:
    name = snapshot.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    first_name = snapshot.get("first_name")
    last_name = snapshot.get("last_name")
    parts = [
        part.strip()
        for part in [first_name, last_name]
        if isinstance(part, str) and part.strip()
    ]
    if parts:
        return " ".join(parts)
    return None


def _combine_address(*parts: str) -> str:
    return " ".join(part.strip() for part in parts if part and part.strip()).strip()


def _shipping_snapshot(order: Order) -> dict[str, object]:
    snapshot = order.shopify_shipping_snapshot_json
    if isinstance(snapshot, dict):
        return snapshot
    return {}


def _extract_shipping_code(payload: dict) -> str:
    return (
        ((payload.get("shipping_data") or {}).get("shipping_code") if isinstance(payload.get("shipping_data"), dict) else None)
        or payload.get("shipping_code")
        or ""
    )


def _extract_tracking_url(payload: dict) -> str | None:
    candidates = [
        payload.get("tracking_url"),
        payload.get("trackingUrl"),
        ((payload.get("shipping_data") or {}).get("tracking_url") if isinstance(payload.get("shipping_data"), dict) else None),
        ((payload.get("shipping_data") or {}).get("trackingUrl") if isinstance(payload.get("shipping_data"), dict) else None),
    ]
    for candidate in candidates:
        normalized = (candidate or "").strip()
        if normalized:
            return normalized
    return None
