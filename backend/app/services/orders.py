from app.models import DesignStatus, Order, OrderStatus


SHIPPED_EVENT_LABELS = {
    "label_created",
    "picked_up",
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
    """An order is personalized exclusively when at least one item has a design_link
    (the image URL that represents the customer's personalised design).
    All other signals (customization_id, notes, assets, keywords) no longer count."""
    for item in items:
        design_link = getattr(item, "design_link", None)
        if design_link and str(design_link).strip():
            return True
    return False


def infer_design_status(item: object, *, is_personalized: bool | None = None) -> DesignStatus | None:
    if is_personalized is None:
        is_personalized = infer_order_is_personalized([item])

    if not is_personalized:
        return None

    # is_personalized is True iff design_link is present, so always design_available here.
    return DesignStatus.design_available


def sync_order_item_design_statuses(order: Order) -> None:
    for item in order.items:
        item.design_status = infer_design_status(item)
