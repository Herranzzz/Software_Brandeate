from app.models import DesignStatus, Order, OrderStatus


SHIPPED_EVENT_LABELS = {
    "label_created",
    "in_transit",
    "out_for_delivery",
    "pickup_available",
}

PERSONALIZATION_KEYWORDS = {
    "personalized",
    "personalizacion",
    "personalizado",
    "custom",
    "monogram",
    "engraving",
    "print on demand",
}


def sync_order_status_from_tracking(order: Order, latest_event_or_status: str) -> None:
    target_status = _resolve_target_status(order, latest_event_or_status)
    if target_status is None:
        return

    current_status = order.status

    if current_status == target_status:
        return

    if current_status == OrderStatus.delivered:
        return

    if current_status == OrderStatus.exception and target_status == OrderStatus.shipped:
        return

    order.status = target_status


def _resolve_target_status(order: Order, latest_event_or_status: str) -> OrderStatus | None:
    if latest_event_or_status == "shipment_created":
        if order.status in {
            OrderStatus.pending,
            OrderStatus.in_progress,
            OrderStatus.ready_to_ship,
        }:
            return OrderStatus.shipped
        return None

    if latest_event_or_status in SHIPPED_EVENT_LABELS:
        return OrderStatus.shipped

    if latest_event_or_status == "delivered":
        return OrderStatus.delivered

    if latest_event_or_status == "exception":
        return OrderStatus.exception

    return None


def infer_order_is_personalized(items: list[object]) -> bool:
    for item in items:
        customization_id = getattr(item, "customization_id", None)
        design_link = getattr(item, "design_link", None)
        personalization_details = getattr(item, "personalization_details_json", None)
        personalization_notes = getattr(item, "personalization_notes", None)
        personalization_assets = getattr(item, "personalization_assets_json", None)
        name = (getattr(item, "name", "") or "").lower()
        sku = (getattr(item, "sku", "") or "").lower()

        if customization_id and str(customization_id).strip():
            return True

        if design_link and str(design_link).strip():
            return True

        if isinstance(personalization_details, list) and len(personalization_details) > 0:
            return True

        if isinstance(personalization_details, dict) and len(personalization_details) > 0:
            return True

        if personalization_notes and str(personalization_notes).strip():
            return True

        if isinstance(personalization_assets, list) and len(personalization_assets) > 0:
            return True

        if isinstance(personalization_assets, dict) and len(personalization_assets) > 0:
            return True

        haystack = f"{name} {sku}"
        if any(keyword in haystack for keyword in PERSONALIZATION_KEYWORDS):
            return True

    return False


def infer_design_status(item: object, *, is_personalized: bool | None = None) -> DesignStatus | None:
    if is_personalized is None:
        is_personalized = infer_order_is_personalized([item])

    if not is_personalized:
        return None

    design_link = (getattr(item, "design_link", None) or "").strip()
    customization_id = (getattr(item, "customization_id", None) or "").strip()
    personalization_notes = (getattr(item, "personalization_notes", None) or "").strip()
    personalization_details = getattr(item, "personalization_details_json", None)
    personalization_assets = getattr(item, "personalization_assets_json", None)

    if design_link:
        return DesignStatus.design_available

    has_assets = False
    if isinstance(personalization_assets, list):
        has_assets = len(personalization_assets) > 0
    elif isinstance(personalization_assets, dict):
        has_assets = len(personalization_assets) > 0

    has_details = False
    if isinstance(personalization_details, list):
        has_details = len(personalization_details) > 0
    elif isinstance(personalization_details, dict):
        has_details = len(personalization_details) > 0

    if customization_id or has_assets or has_details or personalization_notes:
        return DesignStatus.pending_asset

    return DesignStatus.missing_asset


def sync_order_item_design_statuses(order: Order) -> None:
    for item in order.items:
        item.design_status = infer_design_status(item)
