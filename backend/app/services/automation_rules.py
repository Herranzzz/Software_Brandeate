from __future__ import annotations

import ssl
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AutomationActionType,
    AutomationEntityType,
    AutomationEvent,
    DesignStatus,
    Incident,
    IncidentPriority,
    IncidentStatus,
    IncidentType,
    Order,
    OrderPriority,
    OrderStatus,
    ProductionStatus,
)


# An order is flagged as "preparation at risk" only after this many business days
# (Mon–Fri) without transitioning out of pending/in_progress.
PREPARATION_RISK_BUSINESS_DAYS = 3

READY_IDLE_HOURS = 12
TRACKING_STALLED_HOURS = 48

PRIORITY_RANK = {
    OrderPriority.low: 0,
    OrderPriority.normal: 1,
    OrderPriority.high: 2,
    OrderPriority.urgent: 3,
}


@dataclass(frozen=True)
class AutomationFlag:
    key: str
    label: str
    tone: str
    description: str


def build_order_automation_flags(order: Order) -> list[dict]:
    flags: list[AutomationFlag] = []
    design_statuses = {item.design_status for item in order.items if item.design_status is not None}

    if order.has_open_incident:
        flags.append(
            AutomationFlag(
                key="open_incident",
                label="Con incidencia",
                tone="red",
                description="El pedido tiene al menos una incidencia abierta.",
            )
        )

    if order.is_personalized and DesignStatus.missing_asset in design_statuses:
        flags.append(
            AutomationFlag(
                key="missing_design",
                label="Falta diseño",
                tone="red",
                description="Pedido personalizado sin design link ni assets mínimos.",
            )
        )
    elif order.is_personalized and DesignStatus.pending_asset in design_statuses:
        flags.append(
            AutomationFlag(
                key="pending_asset",
                label="Pendiente de asset",
                tone="orange",
                description="Pedido personalizado detectado, pero falta material para producirlo.",
            )
        )
    elif order.is_personalized and DesignStatus.design_available in design_statuses:
        flags.append(
            AutomationFlag(
                key="design_ready",
                label="Diseño listo",
                tone="blue",
                description="El pedido ya tiene un diseño disponible para producción.",
            )
        )

    if _has_incomplete_shipping_address(order):
        flags.append(
            AutomationFlag(
                key="address_incomplete",
                label="Dirección incompleta",
                tone="red",
                description="Faltan datos esenciales del cliente o de la dirección de envío.",
            )
        )

    if order.status == OrderStatus.shipped and order.shipment is None:
        flags.append(
            AutomationFlag(
                key="missing_shipment",
                label="Sin shipment",
                tone="red",
                description="El pedido figura como enviado, pero no existe shipment interno.",
            )
        )

    if order.shipment is not None and not (order.shipment.tracking_number or "").strip():
        flags.append(
            AutomationFlag(
                key="missing_tracking",
                label="Sin tracking",
                tone="orange",
                description="Existe shipment, pero todavía no tiene tracking number asociado.",
            )
        )

    if _is_tracking_stalled(order):
        flags.append(
            AutomationFlag(
                key="tracking_stalled",
                label="Tracking atascado",
                tone="red",
                description="El tracking no ha tenido movimiento reciente dentro del SLA operativo.",
            )
        )

    if _is_order_pending_too_long(order):
        flags.append(
            AutomationFlag(
                key="preparation_risk",
                label="Preparación en riesgo",
                tone="orange",
                description="El pedido lleva demasiado tiempo sin avanzar en preparación.",
            )
        )

    if _is_ready_without_movement(order):
        flags.append(
            AutomationFlag(
                key="ready_idle",
                label="Listo sin mover",
                tone="orange",
                description="El pedido está listo para producir o expedir y no ha tenido movimiento reciente.",
            )
        )

    seen: set[str] = set()
    serialized: list[dict] = []
    for flag in flags:
        if flag.key in seen:
            continue
        seen.add(flag.key)
        serialized.append(
            {
                "key": flag.key,
                "label": flag.label,
                "tone": flag.tone,
                "description": flag.description,
            }
        )
    return serialized


def evaluate_order_automation_rules(
    *,
    db: Session,
    order: Order,
    source: str,
) -> None:
    """Create incidents only for the three approved automatic triggers:
    1. Order stuck in pending/in_progress for more than PREPARATION_RISK_BUSINESS_DAYS business days.
    2. Tracking stalled (carrier has not updated the shipment in TRACKING_STALLED_HOURS hours).
    3. The order's design_link URL returns JSON instead of an image (broken/expired link).
    All other flags remain as visual badges but no longer generate incidents automatically.
    """
    flags = build_order_automation_flags(order)
    flag_keys = {flag["key"] for flag in flags}

    # ── 1. Preparation stuck ≥ 3 business days ──────────────────────────────
    if "preparation_risk" in flag_keys:
        _ensure_incident(
            db=db,
            order=order,
            incident_type=IncidentType.shipping_exception,
            title="Pedido sin preparar desde hace más de 3 días hábiles",
            description=(
                f"El pedido lleva más de {PREPARATION_RISK_BUSINESS_DAYS} días hábiles "
                "en estado pendiente o en producción sin avanzar. Requiere revisión."
            ),
            priority=IncidentPriority.high,
            rule_name="preparation_risk",
        )
        _ensure_automation_event(
            db=db,
            order=order,
            shipment_id=order.shipment.id if order.shipment else None,
            entity_type=AutomationEntityType.order,
            entity_id=order.id,
            rule_name="preparation_risk",
            action_type=AutomationActionType.flag_detected,
            summary="Automatización marcó el pedido como atascado en preparación (≥3 días hábiles).",
            payload={"source": source, "created_at": order.created_at.isoformat()},
        )

    # ── 2. Tracking stalled ──────────────────────────────────────────────────
    if "tracking_stalled" in flag_keys:
        _ensure_incident(
            db=db,
            order=order,
            incident_type=IncidentType.shipping_exception,
            title="Tracking atascado",
            description="El tracking no registra movimiento reciente y requiere revisión operativa.",
            priority=IncidentPriority.high,
            rule_name="tracking_stalled",
        )
        _ensure_automation_event(
            db=db,
            order=order,
            shipment_id=order.shipment.id if order.shipment else None,
            entity_type=AutomationEntityType.shipment if order.shipment else AutomationEntityType.order,
            entity_id=order.shipment.id if order.shipment else order.id,
            rule_name="tracking_stalled",
            action_type=AutomationActionType.flag_detected,
            summary="Automatización marcó el shipment como atascado por falta de movimientos recientes.",
            payload={
                "source": source,
                "last_tracking_event_at": _latest_tracking_timestamp(order),
            },
        )

    # ── 3. Broken design link (URL returns JSON instead of an image) ─────────
    if order.is_personalized and _has_broken_design_link(order):
        _ensure_incident(
            db=db,
            order=order,
            incident_type=IncidentType.missing_asset,
            title="Link de diseño roto (devuelve JSON)",
            description=(
                "El link de imagen del pedido responde con JSON en lugar de una imagen. "
                "El link puede haber caducado o el servicio de personalización tiene un error."
            ),
            priority=IncidentPriority.high,
            rule_name="broken_design_link",
        )
        _ensure_automation_event(
            db=db,
            order=order,
            shipment_id=order.shipment.id if order.shipment else None,
            entity_type=AutomationEntityType.order,
            entity_id=order.id,
            rule_name="broken_design_link",
            action_type=AutomationActionType.flag_detected,
            summary="Automatización detectó un design_link que devuelve JSON en lugar de imagen.",
            payload={"source": source},
        )

    # Automation events only (no incident) for other notable flags
    if "ready_idle" in flag_keys:
        _ensure_automation_event(
            db=db,
            order=order,
            shipment_id=order.shipment.id if order.shipment else None,
            entity_type=AutomationEntityType.order,
            entity_id=order.id,
            rule_name="ready_idle",
            action_type=AutomationActionType.flag_detected,
            summary="Automatización detectó un pedido listo sin movimiento reciente.",
            payload={"source": source},
        )

    target_priority = _resolve_target_priority(order, flag_keys)
    if target_priority is not None and _priority_rank(target_priority) > _priority_rank(order.priority):
        previous_priority = order.priority or OrderPriority.normal
        order.priority = target_priority
        _ensure_automation_event(
            db=db,
            order=order,
            shipment_id=order.shipment.id if order.shipment else None,
            entity_type=AutomationEntityType.order,
            entity_id=order.id,
            rule_name="priority_escalation",
            action_type=AutomationActionType.priority_raised,
            summary=f"Prioridad elevada automáticamente de {previous_priority.value} a {target_priority.value}.",
            payload={
                "source": source,
                "from": previous_priority.value,
                "to": target_priority.value,
                "flags": sorted(flag_keys),
            },
        )


def _ensure_incident(
    *,
    db: Session,
    order: Order,
    incident_type: IncidentType,
    title: str,
    description: str,
    priority: IncidentPriority,
    rule_name: str,
) -> None:
    existing = next(
        (
            incident
            for incident in order.incidents
            if incident.type == incident_type and incident.title == title and incident.status != IncidentStatus.resolved
        ),
        None,
    )
    if existing is not None:
        if priority.value != existing.priority.value:
            existing.priority = priority
        if not existing.is_automated:
            existing.is_automated = True
        if existing.automation_rule_name != rule_name:
            existing.automation_rule_name = rule_name
        return

    incident = Incident(
        type=incident_type,
        priority=priority,
        status=IncidentStatus.open,
        title=title,
        description=description,
        is_automated=True,
        automation_rule_name=rule_name,
    )
    order.incidents.append(incident)
    db.add(incident)

    _ensure_automation_event(
        db=db,
        order=order,
        shipment_id=order.shipment.id if order.shipment else None,
        entity_type=AutomationEntityType.order,
        entity_id=order.id,
        rule_name=rule_name,
        action_type=AutomationActionType.incident_created,
        summary=f"Automatización creó la incidencia: {title}.",
        payload={"incident_type": incident_type.value, "priority": priority.value},
    )


def _ensure_automation_event(
    *,
    db: Session,
    order: Order,
    shipment_id: int | None,
    entity_type: AutomationEntityType,
    entity_id: int | None,
    rule_name: str,
    action_type: AutomationActionType,
    summary: str,
    payload: dict | list | None,
) -> None:
    if entity_id is None or order.id is None:
        return

    fingerprint = f"{entity_type.value}:{entity_id}:{rule_name}:{action_type.value}"
    existing = db.scalar(
        select(AutomationEvent).where(AutomationEvent.fingerprint == fingerprint)
    )
    if existing is not None:
        return

    db.add(
        AutomationEvent(
            shop_id=order.shop_id,
            order_id=order.id,
            shipment_id=shipment_id,
            entity_type=entity_type,
            entity_id=entity_id,
            rule_name=rule_name,
            action_type=action_type,
            summary=summary,
            payload_json=payload,
            fingerprint=fingerprint,
        )
    )


def _resolve_target_priority(order: Order, flag_keys: set[str]) -> OrderPriority | None:
    if "missing_shipment" in flag_keys:
        return OrderPriority.urgent
    if "tracking_stalled" in flag_keys or "address_incomplete" in flag_keys:
        return OrderPriority.high
    if "missing_design" in flag_keys:
        return OrderPriority.high
    if "pending_asset" in flag_keys and order.is_personalized:
        return OrderPriority.high
    if "preparation_risk" in flag_keys or "ready_idle" in flag_keys or "missing_tracking" in flag_keys:
        return OrderPriority.high
    if order.has_open_incident:
        return OrderPriority.high
    return None


def _priority_rank(priority: OrderPriority | None) -> int:
    return PRIORITY_RANK.get(priority, 0)


def _hours_since(value: datetime | None) -> float | None:
    if value is None:
        return None
    return max(0.0, (datetime.now(timezone.utc) - value.astimezone(timezone.utc)).total_seconds() / 3600)


def _has_incomplete_shipping_address(order: Order) -> bool:
    required_fields = [
        order.shipping_name or order.customer_name,
        order.shipping_postal_code,
        order.shipping_address_line1,
        order.shipping_town,
        order.shipping_country_code,
        order.shipping_phone or order.customer_email,
    ]
    return any(not (value or "").strip() for value in required_fields)


def _latest_tracking_timestamp(order: Order) -> str | None:
    if order.shipment is None or not order.shipment.events:
        return None
    latest = max(order.shipment.events, key=lambda event: event.occurred_at)
    return latest.occurred_at.isoformat()


def _is_tracking_stalled(order: Order) -> bool:
    if order.shipment is None or order.status in {OrderStatus.delivered, OrderStatus.exception}:
        return False
    if not order.shipment.tracking_number:
        return False
    last_event_time = max((event.occurred_at for event in order.shipment.events), default=order.shipment.created_at)
    hours = _hours_since(last_event_time)
    return hours is not None and hours >= TRACKING_STALLED_HOURS


def _business_days_since(value: datetime | None) -> float | None:
    """Return the number of completed business days (Mon–Fri) since *value*."""
    if value is None:
        return None
    now = datetime.now(timezone.utc)
    start = value.astimezone(timezone.utc)
    if now <= start:
        return 0.0
    count = 0
    current = start.date()
    end_date = now.date()
    while current < end_date:
        if current.weekday() < 5:  # 0=Mon … 4=Fri
            count += 1
        current += timedelta(days=1)
    return float(count)


def _is_order_pending_too_long(order: Order) -> bool:
    if order.status not in {OrderStatus.pending, OrderStatus.in_progress}:
        return False
    days = _business_days_since(order.created_at)
    return days is not None and days >= PREPARATION_RISK_BUSINESS_DAYS


def _url_returns_json(url: str, timeout: int = 4) -> bool:
    """Return True if the URL responds with a JSON Content-Type instead of an image.
    Returns False on any network/timeout error (don't flag uncertain cases)."""
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            content_type = (resp.headers.get("Content-Type") or "").lower()
            return "json" in content_type
    except Exception:
        return False


def _has_broken_design_link(order: Order) -> bool:
    """Return True if any item has a design_link that responds with JSON.
    Skips the HTTP check when the order already has an open broken_design_link incident
    (idempotency – avoids hammering the same URL repeatedly)."""
    already_flagged = any(
        getattr(inc, "automation_rule_name", None) == "broken_design_link"
        and inc.status != IncidentStatus.resolved
        for inc in order.incidents
    )
    if already_flagged:
        return True  # Already known broken; let _ensure_incident handle idempotency

    for item in order.items:
        url = (item.design_link or "").strip()
        if url and _url_returns_json(url):
            return True
    return False


def _is_ready_without_movement(order: Order) -> bool:
    if order.production_status not in {ProductionStatus.pending_personalization, ProductionStatus.packed, ProductionStatus.completed} and order.status != OrderStatus.ready_to_ship:
        return False

    if order.production_status == ProductionStatus.pending_personalization:
        has_design_ready = any(item.design_status == DesignStatus.design_available for item in order.items)
        if not has_design_ready:
            return False

    reference_time = order.shipment.created_at if order.shipment else order.created_at
    hours = _hours_since(reference_time)
    return hours is not None and hours >= READY_IDLE_HOURS
