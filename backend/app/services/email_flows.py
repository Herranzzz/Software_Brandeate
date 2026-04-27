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
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

from sqlalchemy import and_, exists, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.email_flow import EmailFlow, EmailFlowDraft, EmailFlowLog, EmailFlowType
from app.models.order import Order, OrderStatus
from app.models.shop import Shop
from app.services.email_agent import generate_agent_email, is_agent_enabled
from app.services.email_context import build_email_context, safe_subject
from app.services.email_templates import render_email

# Bound retry attempts for transient SMTP failures. After MAX_ATTEMPTS the
# row stays as 'failed' permanently and the scheduler skips it.
MAX_ATTEMPTS = 3
RETRY_BACKOFF_MINUTES = (5, 30, 240)  # 5min, 30min, 4h between attempts
SCHEDULER_LOOKBACK_DAYS = 30

logger = logging.getLogger(__name__)


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
    """Scheduler safety-net. Only handles orders that an inline trigger missed.

    The query restricts to:
      * orders created within SCHEDULER_LOOKBACK_DAYS,
      * with a customer_email,
      * that have no 'sent' log yet for the flow type (NOT EXISTS),
      * and with shipment state matching the flow's preconditions.

    The atomic claim in _trigger_flow handles concurrency. We commit
    per-order so a single failure doesn't roll back the whole sweep.
    """
    sent = failed = skipped = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=SCHEDULER_LOOKBACK_DAYS)

    base = (
        select(Order)
        .where(Order.customer_email.isnot(None))
        .where(Order.created_at >= cutoff)
    )
    if shop_ids:
        base = base.where(Order.shop_id.in_(shop_ids))

    def _no_sent_log(flow_type: EmailFlowType):
        return ~exists().where(
            and_(
                EmailFlowLog.shop_id == Order.shop_id,
                EmailFlowLog.order_id == Order.id,
                EmailFlowLog.flow_type == flow_type.value,
                EmailFlowLog.status == "sent",
            )
        )

    def _process(orders: list[Order], flow_type: EmailFlowType) -> None:
        nonlocal sent, failed, skipped
        for order in orders:
            try:
                if _trigger_flow(db, order, flow_type):
                    sent += 1
                    db.commit()
                else:
                    skipped += 1
            except Exception:
                logger.exception(
                    "Email flow %s failed for order id=%s", flow_type.value, order.id
                )
                db.rollback()
                failed += 1

    pending_post = list(db.scalars(
        base.where(Order.status != OrderStatus.cancelled)
        .where(_no_sent_log(EmailFlowType.post_purchase))
    ))
    _process(pending_post, EmailFlowType.post_purchase)

    pending_ship = list(db.scalars(
        base.where(Order.status.in_({OrderStatus.shipped, OrderStatus.delivered}))
        .where(_no_sent_log(EmailFlowType.shipping_update))
    ))
    pending_ship = [
        o for o in pending_ship
        if o.shipment
        and (o.shipment.shipping_status or "").lower()
        in {"in_transit", "out_for_delivery", "picked_up", "delivered"}
    ]
    _process(pending_ship, EmailFlowType.shipping_update)

    pending_delivery = list(db.scalars(
        base.where(Order.status == OrderStatus.delivered)
        .where(_no_sent_log(EmailFlowType.delivery))
    ))
    _process(pending_delivery, EmailFlowType.delivery)

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
    """Core trigger: atomically claim the (order, flow_type) slot, then send.

    Idempotency is enforced by a partial unique index on
    email_flow_logs(shop_id, order_id, flow_type) WHERE status='sent'.
    Concurrent callers race on the INSERT; the loser gets DO NOTHING and
    skips. Failed sends release the slot so a future cycle can retry,
    bounded by attempts and next_attempt_at.
    """
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

    if dry_check:
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
        return not already_sent

    # Respect retry bookkeeping from prior failed attempts.
    last_failed = db.scalar(
        select(EmailFlowLog)
        .where(
            and_(
                EmailFlowLog.shop_id == order.shop_id,
                EmailFlowLog.flow_type == flow_type.value,
                EmailFlowLog.order_id == order.id,
                EmailFlowLog.status == "failed",
            )
        )
        .order_by(EmailFlowLog.sent_at.desc())
        .limit(1)
    )
    now = datetime.now(timezone.utc)
    next_attempts = 1
    if last_failed is not None:
        if last_failed.attempts >= MAX_ATTEMPTS:
            return False
        if last_failed.next_attempt_at and last_failed.next_attempt_at > now:
            return False
        next_attempts = last_failed.attempts + 1

    # Atomic claim: only one worker wins the partial unique index.
    claim_stmt = (
        pg_insert(EmailFlowLog)
        .values(
            shop_id=order.shop_id,
            flow_id=flow.id,
            flow_type=flow_type.value,
            order_id=order.id,
            to_email=to_email,
            status="sent",
            attempts=next_attempts,
            sent_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=["shop_id", "order_id", "flow_type"],
            index_where=text("status = 'sent' AND order_id IS NOT NULL"),
        )
        .returning(EmailFlowLog.id)
    )
    log_id = db.execute(claim_stmt).scalar()
    if log_id is None:
        # Another worker already holds the slot, or it was already sent.
        return False
    db.flush()

    shop = db.get(Shop, order.shop_id)
    ctx = build_email_context(order, shop)

    template_rendered = render_email(
        flow_type,
        ctx,
        subject_template_override=flow.subject_template,
    )

    # When the agent is enabled, generate a draft. In shadow mode the
    # template version is what the customer receives; the draft is
    # persisted for offline review. Out of shadow mode the agent
    # version is what gets sent — unless confidence is too low or the
    # order has open incidents, in which case we fall back.
    settings = get_settings()
    agent_result = None
    if is_agent_enabled():
        agent_result = generate_agent_email(flow_type, ctx, shop)

    use_agent_for_send = (
        agent_result is not None
        and not settings.email_agent_shadow_mode
        and not agent_result.requires_human_review
        and agent_result.error is None
    )

    if use_agent_for_send and agent_result is not None:
        outbound = agent_result.rendered
    else:
        outbound = template_rendered

    if agent_result is not None:
        try:
            db.add(EmailFlowDraft(
                shop_id=order.shop_id,
                order_id=order.id,
                flow_type=flow_type.value,
                locale=ctx.locale,
                model=agent_result.model,
                persona_name=agent_result.persona_name,
                subject=agent_result.rendered.subject[:512],
                body_text=agent_result.rendered.text,
                body_html=agent_result.rendered.html,
                confidence=agent_result.confidence,
                requires_human_review=agent_result.requires_human_review,
                template_subject=template_rendered.subject[:512],
                template_body_text=template_rendered.text,
                was_sent=use_agent_for_send,
                shadow_mode=settings.email_agent_shadow_mode,
                error_message=agent_result.error,
            ))
            db.flush()
        except Exception:
            logger.exception("Failed to persist email_flow_draft for order %s", order.id)

    subject = safe_subject(outbound.subject)
    headers = _thread_headers(order, flow_type)

    success, error = _send_smtp(
        to_email=to_email,
        subject=subject,
        html=outbound.html,
        text=outbound.text,
        from_name=flow.from_name or ctx.shop_name,
        from_email=flow.from_email,
        reply_to=flow.reply_to,
        extra_headers=headers,
    )

    if not success:
        backoff_idx = min(next_attempts - 1, len(RETRY_BACKOFF_MINUTES) - 1)
        next_at = now + timedelta(minutes=RETRY_BACKOFF_MINUTES[backoff_idx])
        db.execute(
            update(EmailFlowLog)
            .where(EmailFlowLog.id == log_id)
            .values(
                status="failed",
                error_message=(error or "")[:1024] or None,
                next_attempt_at=next_at,
            )
        )
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
    text: str,
    from_name: str,
    from_email: str | None,
    reply_to: str | None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[bool, str | None]:
    host = os.environ.get("MAIL_HOST", "")
    if not host:
        logger.info("MAIL_HOST not set — skipping email flow to %s", to_email)
        return False, "MAIL_HOST not configured"

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
    msg["Date"] = formatdate(localtime=False)
    if reply_to:
        msg["Reply-To"] = reply_to

    unsubscribe = _list_unsubscribe_headers(reply_to or default_from)
    for key, value in unsubscribe.items():
        msg[key] = value

    if extra_headers:
        for key, value in extra_headers.items():
            if value:
                msg[key] = value

    # multipart/alternative: text first, then HTML — clients pick the
    # richest part they support but plain-text is what spam filters and
    # accessibility tools read.
    msg.attach(MIMEText(text, "plain", "utf-8"))
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
        return True, None
    except Exception as exc:
        logger.error("Email flow failed → %s: %s", to_email, exc)
        return False, f"{type(exc).__name__}: {exc}"


def _message_id_domain() -> str:
    raw = os.environ.get("MAIL_FROM", "") or os.environ.get("MAIL_USER", "")
    if "@" in raw:
        return raw.rsplit("@", 1)[-1].strip("> ")
    return "brandeate.app"


def _thread_headers(order: Order, flow_type: EmailFlowType) -> dict[str, str]:
    """Build Message-ID + In-Reply-To/References so MUAs collapse the thread.

    The post_purchase email is the thread root with a deterministic
    Message-ID (`<order-{id}-root@domain>`). Subsequent flows reference
    that same root so Gmail/Outlook show one conversation per order
    instead of three loose emails.
    """
    domain = _message_id_domain()
    root_id = f"<order-{order.id}-root@{domain}>"

    if flow_type == EmailFlowType.post_purchase:
        return {"Message-ID": root_id}

    own_id = make_msgid(idstring=f"order-{order.id}-{flow_type.value}", domain=domain)
    return {
        "Message-ID": own_id,
        "In-Reply-To": root_id,
        "References": root_id,
    }


def _list_unsubscribe_headers(from_addr: str | None) -> dict[str, str]:
    """RFC 2369 + RFC 8058 unsubscribe headers.

    A mailto: target is enough for Gmail/Apple Mail to render the
    "Unsubscribe" affordance. Customers replying with UNSUBSCRIBE in
    the body can be processed by inbound parsing later (Phase 3).
    """
    target = (from_addr or "").strip("<> ")
    if not target or "@" not in target:
        return {}
    return {
        "List-Unsubscribe": f"<mailto:{target}?subject=unsubscribe>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


