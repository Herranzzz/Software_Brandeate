"""Email marketing flows service.

Manages three automated email flows per shop:
  post_purchase   – sent when a new order is confirmed
  shipping_update – sent when the shipment first enters in_transit
  delivery        – sent when the order is delivered

Each flow is configured per-shop via EmailFlow records. If no record exists,
defaults are created on first use. The EmailFlowLog prevents duplicate sends.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session

from app.models.email_flow import EmailFlow, EmailFlowLog, EmailFlowType
from app.models.order import Order, OrderStatus
from app.models.shop import Shop

logger = logging.getLogger(__name__)

BRAND_RED = "#e8392b"

_DEFAULT_SUBJECTS: dict[str, str] = {
    EmailFlowType.post_purchase: "Hemos recibido tu pedido {order_id} – {shop_name}",
    EmailFlowType.shipping_update: "Tu pedido {order_id} ya está en camino – {shop_name}",
    EmailFlowType.delivery: "Tu pedido {order_id} ha sido entregado – {shop_name}",
    EmailFlowType.abandon_cart: "¿Olvidaste algo? Tu carrito te espera – {shop_name}",
}


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def get_or_create_flows(db: Session, shop_id: int) -> list[EmailFlow]:
    """Return all EmailFlow rows for this shop, creating defaults if missing."""
    existing = {
        f.flow_type: f
        for f in db.scalars(select(EmailFlow).where(EmailFlow.shop_id == shop_id))
    }
    for flow_type in EmailFlowType:
        if flow_type.value not in existing:
            flow = EmailFlow(shop_id=shop_id, flow_type=flow_type.value, is_enabled=False)
            db.add(flow)
            existing[flow_type.value] = flow
    db.flush()
    return list(existing.values())


def trigger_post_purchase(db: Session, order: Order) -> bool:
    """Send post-purchase email for the given order. Returns True if sent."""
    return _trigger_flow(db, order, EmailFlowType.post_purchase)


def trigger_shipping_update(db: Session, order: Order) -> bool:
    """Send shipping update email when order enters transit. Returns True if sent."""
    return _trigger_flow(db, order, EmailFlowType.shipping_update)


def trigger_delivery(db: Session, order: Order) -> bool:
    """Send delivery confirmation email. Returns True if sent."""
    return _trigger_flow(db, order, EmailFlowType.delivery)


def run_pending_flows(db: Session, shop_ids: list[int] | None = None) -> dict[str, int]:
    """Scheduler-callable function. Catches orders that missed event-based triggers."""
    sent = failed = skipped = 0

    query = select(Shop)
    if shop_ids:
        query = query.where(Shop.id.in_(shop_ids))
    shops = list(db.scalars(query))

    for shop in shops:
        orders = list(db.scalars(
            select(Order)
            .where(Order.shop_id == shop.id)
            .where(Order.customer_email.isnot(None))
        ))
        for order in orders:
            # post_purchase: all non-cancelled orders
            if order.status not in {OrderStatus.delivered} and order.status != "cancelled":
                if _trigger_flow(db, order, EmailFlowType.post_purchase, dry_check=False):
                    sent += 1
                else:
                    skipped += 1

            # shipping_update: orders that are shipped / in transit
            if order.status in {OrderStatus.shipped, OrderStatus.delivered}:
                if order.shipment and (order.shipment.shipping_status or "").lower() in {
                    "in_transit", "out_for_delivery", "picked_up"
                }:
                    if _trigger_flow(db, order, EmailFlowType.shipping_update, dry_check=False):
                        sent += 1
                    else:
                        skipped += 1

            # delivery: delivered orders
            if order.status == OrderStatus.delivered:
                if _trigger_flow(db, order, EmailFlowType.delivery, dry_check=False):
                    sent += 1
                else:
                    skipped += 1

    db.commit()
    return {"sent": sent, "failed": failed, "skipped": skipped}


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────

def _trigger_flow(
    db: Session,
    order: Order,
    flow_type: EmailFlowType,
    dry_check: bool = False,
) -> bool:
    """Core trigger: check flow is enabled, no duplicate log, then send."""
    to_email = order.customer_email
    if not to_email:
        return False

    flow = db.scalar(
        select(EmailFlow).where(
            and_(EmailFlow.shop_id == order.shop_id, EmailFlow.flow_type == flow_type.value)
        )
    )
    if flow is None or not flow.is_enabled:
        return False

    already_sent = db.scalar(
        select(
            exists().where(
                and_(
                    EmailFlowLog.shop_id == order.shop_id,
                    EmailFlowLog.flow_type == flow_type.value,
                    EmailFlowLog.order_id == order.id,
                    EmailFlowLog.status == "sent",
                )
            )
        )
    )
    if already_sent:
        return False

    if dry_check:
        return True

    shop = db.get(Shop, order.shop_id)
    shop_name = shop.name if shop else "Brandeate"
    order_id = str(order.external_id or order.id)

    subject_tpl = flow.subject_template or _DEFAULT_SUBJECTS.get(flow_type.value, "")
    subject = subject_tpl.format(order_id=order_id, shop_name=shop_name)

    tracking_url = _get_tracking_url(order)
    html = _build_html(
        flow_type=flow_type,
        shop_name=shop_name,
        order_id=order_id,
        customer_name=order.customer_name or order.shipping_name or "",
        tracking_url=tracking_url,
        carrier=order.shipment.carrier if order.shipment else None,
        accent_color=_get_accent(shop),
    )

    success = _send_smtp(
        to_email=to_email,
        subject=subject,
        html=html,
        from_name=flow.from_name or shop_name,
        from_email=flow.from_email,
        reply_to=flow.reply_to,
    )

    log = EmailFlowLog(
        shop_id=order.shop_id,
        flow_id=flow.id,
        flow_type=flow_type.value,
        order_id=order.id,
        to_email=to_email,
        status="sent" if success else "failed",
        sent_at=datetime.now(timezone.utc),
    )
    db.add(log)
    db.flush()
    return success


def _get_tracking_url(order: Order) -> str | None:
    if order.shipment and order.shipment.public_token:
        base = os.environ.get("PUBLIC_TRACKING_BASE_URL", "").rstrip("/")
        if base:
            return f"{base}/{order.shipment.public_token}"
    return None


def _get_accent(shop: Shop | None) -> str:
    if shop and shop.tracking_config_json:
        color = shop.tracking_config_json.get("accent_color")
        if color and str(color).startswith("#"):
            return str(color)
    return BRAND_RED


def _send_smtp(
    *,
    to_email: str,
    subject: str,
    html: str,
    from_name: str,
    from_email: str | None,
    reply_to: str | None,
) -> bool:
    host = os.environ.get("MAIL_HOST", "")
    if not host:
        logger.info("MAIL_HOST not set — skipping email flow to %s", to_email)
        return False

    port = int(os.environ.get("MAIL_PORT", "587"))
    user = os.environ.get("MAIL_USER", "")
    password = os.environ.get("MAIL_PASSWORD", "")
    default_from = os.environ.get("MAIL_FROM", "") or user
    use_tls = os.environ.get("MAIL_TLS", "true").lower() != "false"

    sender = f"{from_name} <{from_email or default_from}>" if from_name else (from_email or default_from)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if use_tls:
            with smtplib.SMTP(host, port) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
        else:
            with smtplib.SMTP_SSL(host, port) as smtp:
                smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
        logger.info("Email flow sent: %s → %s", subject, to_email)
        return True
    except Exception as exc:
        logger.error("Email flow failed → %s: %s", to_email, exc)
        return False


# ──────────────────────────────────────────────────────────────────────────────
# HTML templates
# ──────────────────────────────────────────────────────────────────────────────

def _build_html(
    *,
    flow_type: EmailFlowType,
    shop_name: str,
    order_id: str,
    customer_name: str,
    tracking_url: str | None,
    carrier: str | None,
    accent_color: str,
) -> str:
    greeting = f"Hola{' ' + customer_name.split()[0] if customer_name else ''},"

    if flow_type == EmailFlowType.post_purchase:
        icon = "📦"
        headline = f"Tu pedido <strong>{order_id}</strong> ha sido confirmado"
        body = (
            "Hemos recibido tu pedido correctamente. Nuestro equipo ya está preparándolo "
            "con todo el cuidado que merece. Recibirás otro correo en cuanto esté listo para envío."
        )
        cta_label = "Ver seguimiento"
        cta_url = tracking_url

    elif flow_type == EmailFlowType.shipping_update:
        icon = "🚚"
        headline = f"Tu pedido <strong>{order_id}</strong> está de camino"
        carrier_txt = f" con {carrier}" if carrier else ""
        body = (
            f"¡Tu pedido ha salido{carrier_txt} y está en ruta hacia ti! "
            "Usa el enlace de seguimiento para consultar el estado en tiempo real."
        )
        cta_label = "Seguir mi pedido"
        cta_url = tracking_url

    elif flow_type == EmailFlowType.delivery:
        icon = "✅"
        headline = f"Tu pedido <strong>{order_id}</strong> ha sido entregado"
        body = (
            "¡La entrega ha sido confirmada! Esperamos que estés disfrutando de tu compra. "
            "Si tienes cualquier consulta no dudes en contactarnos."
        )
        cta_label = "Ver mi pedido"
        cta_url = tracking_url

    else:
        icon = "🛒"
        headline = "Tu carrito te espera"
        body = "Tienes artículos esperándote. ¡Completa tu compra antes de que se agoten!"
        cta_label = "Volver a mi carrito"
        cta_url = None

    cta_block = ""
    if cta_url and cta_label:
        cta_block = f"""
          <a href="{cta_url}" style="display:inline-block;background:{accent_color};color:#fff;
          text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;
          font-weight:600;margin-top:8px;">{cta_label} →</a>"""

    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:{accent_color};padding:20px 32px;display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">{icon}</span>
            <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">{shop_name}</span>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <p style="color:#111;font-size:18px;font-weight:600;margin:0 0 16px;">{greeting}</p>
          <p style="color:#111;font-size:16px;font-weight:600;margin:0 0 12px;">{headline}</p>
          <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px;">{body}</p>
          {cta_block}
          <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px;">
          <p style="color:#999;font-size:12px;margin:0;">
            Logística gestionada por <strong>Brandeate</strong>.
            Este mensaje ha sido enviado automáticamente.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>""".strip()
