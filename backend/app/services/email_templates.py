"""Render flow emails from an EmailContext.

Replaces the previous hardcoded HTML in email_flows.py with three
locale-aware copies (es / en / pt) and a shared HTML shell. Always
emits a plain-text alternative so MIME multipart/alternative works.

Templates intentionally avoid promising specific dates unless the
context actually has them (`expected_delivery_date`). They surface
items, address, latest tracking event and ETA when present, and they
stay generic when those fields are None.
"""

from __future__ import annotations

import html as html_lib
from dataclasses import dataclass

from app.models.email_flow import EmailFlowType
from app.services.email_context import EmailContext


@dataclass
class RenderedEmail:
    subject: str
    html: str
    text: str


# ──────────────────────────────────────────────────────────────────────────────
# Copy strings per (flow, locale)
# ──────────────────────────────────────────────────────────────────────────────

_COPY: dict[tuple[str, str], dict[str, str]] = {
    # post_purchase ────────────────────────────────────────────────────────────
    ("post_purchase", "es"): {
        "subject": "Hemos recibido tu pedido {order_id} – {shop_name}",
        "greeting": "Hola {first_name},",
        "headline": "Tu pedido <strong>{order_id}</strong> está confirmado",
        "lead": "¡Gracias por tu compra! Hemos recibido tu pedido y estamos preparándolo con cuidado. Recibirás otro correo en este mismo hilo en cuanto salga.",
        "items_label": "Tu pedido",
        "address_label": "Dirección de envío",
        "cta": "Ver el estado de mi pedido",
        "outro": "Si tienes cualquier duda, simplemente responde a este correo.",
    },
    ("post_purchase", "en"): {
        "subject": "We received your order {order_id} – {shop_name}",
        "greeting": "Hi {first_name},",
        "headline": "Your order <strong>{order_id}</strong> is confirmed",
        "lead": "Thanks for your purchase! We've received your order and are getting it ready. You'll hear from us in this same thread the moment it ships.",
        "items_label": "Your order",
        "address_label": "Shipping address",
        "cta": "Track my order",
        "outro": "If you have any questions, just reply to this email.",
    },
    ("post_purchase", "pt"): {
        "subject": "Recebemos a tua encomenda {order_id} – {shop_name}",
        "greeting": "Olá {first_name},",
        "headline": "A tua encomenda <strong>{order_id}</strong> está confirmada",
        "lead": "Obrigado pela tua compra! Recebemos a tua encomenda e já a estamos a preparar. Voltamos a falar contigo neste mesmo email assim que for expedida.",
        "items_label": "A tua encomenda",
        "address_label": "Morada de entrega",
        "cta": "Acompanhar a minha encomenda",
        "outro": "Se tiveres dúvidas, responde a este email.",
    },

    # shipping_update ──────────────────────────────────────────────────────────
    ("shipping_update", "es"): {
        "subject": "Tu pedido {order_id} ya está en camino – {shop_name}",
        "greeting": "Hola {first_name},",
        "headline": "Tu pedido <strong>{order_id}</strong> está en camino",
        "lead_with_carrier": "Tu pedido ha salido con {carrier} y está de camino.",
        "lead_no_carrier": "Tu pedido ha salido y está de camino.",
        "eta": "Llegada estimada: <strong>{eta}</strong>.",
        "last_event": "Último movimiento: {event} ({location}).",
        "last_event_no_loc": "Último movimiento: {event}.",
        "pickup": "Recogerás tu pedido en {pickup_point}.",
        "cta": "Seguir mi pedido en tiempo real",
        "outro": "Si necesitas algo, responde a este correo.",
    },
    ("shipping_update", "en"): {
        "subject": "Your order {order_id} is on its way – {shop_name}",
        "greeting": "Hi {first_name},",
        "headline": "Your order <strong>{order_id}</strong> is on its way",
        "lead_with_carrier": "Your order has shipped with {carrier} and is on its way.",
        "lead_no_carrier": "Your order has shipped and is on its way.",
        "eta": "Estimated arrival: <strong>{eta}</strong>.",
        "last_event": "Last update: {event} ({location}).",
        "last_event_no_loc": "Last update: {event}.",
        "pickup": "You'll pick it up at {pickup_point}.",
        "cta": "Track my order in real time",
        "outro": "Need anything? Just reply to this email.",
    },
    ("shipping_update", "pt"): {
        "subject": "A tua encomenda {order_id} já está a caminho – {shop_name}",
        "greeting": "Olá {first_name},",
        "headline": "A tua encomenda <strong>{order_id}</strong> está a caminho",
        "lead_with_carrier": "A tua encomenda saiu com {carrier} e está a caminho.",
        "lead_no_carrier": "A tua encomenda saiu e está a caminho.",
        "eta": "Chegada prevista: <strong>{eta}</strong>.",
        "last_event": "Último movimento: {event} ({location}).",
        "last_event_no_loc": "Último movimento: {event}.",
        "pickup": "Vais levantar a encomenda em {pickup_point}.",
        "cta": "Acompanhar em tempo real",
        "outro": "Precisas de algo? Responde a este email.",
    },

    # delivery ─────────────────────────────────────────────────────────────────
    ("delivery", "es"): {
        "subject": "Tu pedido {order_id} ha sido entregado – {shop_name}",
        "greeting": "Hola {first_name},",
        "headline": "Tu pedido <strong>{order_id}</strong> ha sido entregado",
        "lead": "¡La entrega ha sido confirmada! Esperamos que disfrutes de tu compra.",
        "lead_pickup": "Tu pedido está listo para que lo recojas en {pickup_point}.",
        "cta": "Ver mi pedido",
        "outro": "Si algo no cuadra, responde a este correo y te ayudamos enseguida.",
    },
    ("delivery", "en"): {
        "subject": "Your order {order_id} has been delivered – {shop_name}",
        "greeting": "Hi {first_name},",
        "headline": "Your order <strong>{order_id}</strong> has been delivered",
        "lead": "Delivery confirmed! We hope you love it.",
        "lead_pickup": "Your order is ready to be picked up at {pickup_point}.",
        "cta": "View my order",
        "outro": "Anything off? Reply to this email and we'll sort it out.",
    },
    ("delivery", "pt"): {
        "subject": "A tua encomenda {order_id} foi entregue – {shop_name}",
        "greeting": "Olá {first_name},",
        "headline": "A tua encomenda <strong>{order_id}</strong> foi entregue",
        "lead": "Entrega confirmada! Esperamos que gostes.",
        "lead_pickup": "A tua encomenda está pronta para levantamento em {pickup_point}.",
        "cta": "Ver a minha encomenda",
        "outro": "Algo não está bem? Responde a este email e tratamos disso.",
    },
}

_AUTO_FOOTER = {
    "es": "Logística gestionada por <strong>Brandeate</strong>. Si no quieres recibir más correos, escribe «BAJA» como respuesta.",
    "en": "Logistics handled by <strong>Brandeate</strong>. To stop receiving these, reply with “UNSUBSCRIBE”.",
    "pt": "Logística gerida pela <strong>Brandeate</strong>. Para deixares de receber, responde com «CANCELAR».",
}


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def render_email(
    flow_type: EmailFlowType,
    ctx: EmailContext,
    *,
    subject_template_override: str | None = None,
) -> RenderedEmail:
    locale = ctx.locale if ctx.locale in {"es", "en", "pt"} else "es"
    copy = _COPY.get((flow_type.value, locale)) or _COPY[(flow_type.value, "es")]

    subject_tpl = subject_template_override or copy["subject"]
    subject = subject_tpl.format(
        order_id=ctx.order_id_external,
        shop_name=ctx.shop_name,
        first_name=ctx.customer_first_name or "",
    ).strip()

    greeting = copy["greeting"].format(first_name=ctx.customer_first_name or "").rstrip(", ").rstrip() + ","

    lead = _build_lead(flow_type, copy, ctx)
    extras = _build_extras(flow_type, copy, ctx)
    blocks = _build_blocks(flow_type, copy, ctx)
    cta = _build_cta(copy, ctx)
    outro = copy.get("outro", "")
    footer = _AUTO_FOOTER.get(locale, _AUTO_FOOTER["es"])

    html = _HTML_SHELL.format(
        lang=locale,
        accent=_h(ctx.accent_color),
        shop_name=_h(ctx.shop_name),
        greeting=_h(greeting),
        headline=copy["headline"].format(order_id=_h(ctx.order_id_external)),
        lead=_h(lead),
        extras_html=extras,
        blocks_html=blocks,
        cta_html=cta,
        outro=_h(outro),
        footer=footer,
    )

    text = _build_plain_text(flow_type, copy, ctx, greeting, lead, outro, footer)
    return RenderedEmail(subject=subject, html=html, text=text)


# ──────────────────────────────────────────────────────────────────────────────
# Section builders
# ──────────────────────────────────────────────────────────────────────────────

def _build_lead(flow_type: EmailFlowType, copy: dict[str, str], ctx: EmailContext) -> str:
    if flow_type == EmailFlowType.shipping_update:
        if ctx.tracking.carrier:
            return copy["lead_with_carrier"].format(carrier=ctx.tracking.carrier)
        return copy["lead_no_carrier"]
    if flow_type == EmailFlowType.delivery:
        if ctx.tracking.is_pickup_point and ctx.tracking.pickup_point_name:
            return copy["lead_pickup"].format(pickup_point=ctx.tracking.pickup_point_name)
        return copy["lead"]
    return copy["lead"]


def _build_extras(flow_type: EmailFlowType, copy: dict[str, str], ctx: EmailContext) -> str:
    parts: list[str] = []
    if flow_type == EmailFlowType.shipping_update:
        eta = ctx.tracking.expected_delivery_date
        if eta:
            parts.append(f"<p style='margin:0 0 8px;color:#374151;font-size:14px;'>{copy['eta'].format(eta=_h(eta.isoformat()))}</p>")
        last_event = ctx.tracking.status_detail or ctx.tracking.status
        if last_event:
            tpl = copy["last_event"] if ctx.tracking.location else copy["last_event_no_loc"]
            parts.append(
                f"<p style='margin:0 0 8px;color:#6b7280;font-size:13px;'>"
                f"{tpl.format(event=_h(last_event), location=_h(ctx.tracking.location or ''))}</p>"
            )
        if ctx.tracking.is_pickup_point and ctx.tracking.pickup_point_name:
            parts.append(
                f"<p style='margin:0 0 8px;color:#6b7280;font-size:13px;'>"
                f"{copy['pickup'].format(pickup_point=_h(ctx.tracking.pickup_point_name))}</p>"
            )
    return "".join(parts)


def _build_blocks(flow_type: EmailFlowType, copy: dict[str, str], ctx: EmailContext) -> str:
    parts: list[str] = []

    # Items block — only for post_purchase (avoid noise on later emails).
    if flow_type == EmailFlowType.post_purchase and ctx.items:
        rows = "".join(
            f"<tr><td style='padding:6px 0;color:#111827;font-size:14px;'>"
            f"{_h(item.name)}{(' — ' + _h(item.variant)) if item.variant else ''}</td>"
            f"<td style='padding:6px 0;color:#6b7280;font-size:14px;text-align:right;'>×{item.quantity}</td></tr>"
            for item in ctx.items
        )
        parts.append(
            f"<div style='margin:24px 0 0;padding:16px;background:#f9fafb;border-radius:8px;'>"
            f"<p style='margin:0 0 8px;color:#374151;font-size:13px;font-weight:600;'>{_h(copy['items_label'])}</p>"
            f"<table width='100%' cellpadding='0' cellspacing='0'>{rows}</table>"
            f"</div>"
        )

    # Address block — only for post_purchase.
    if flow_type == EmailFlowType.post_purchase and ctx.shipping_address_line:
        parts.append(
            f"<div style='margin:16px 0 0;padding:16px;background:#f9fafb;border-radius:8px;'>"
            f"<p style='margin:0 0 4px;color:#374151;font-size:13px;font-weight:600;'>{_h(copy['address_label'])}</p>"
            f"<p style='margin:0;color:#6b7280;font-size:13px;'>{_h(ctx.shipping_address_line)}</p>"
            f"</div>"
        )

    return "".join(parts)


def _build_cta(copy: dict[str, str], ctx: EmailContext) -> str:
    url = ctx.tracking.tracking_url
    if not url:
        return ""
    return (
        f"<p style='margin:24px 0 0;'>"
        f"<a href='{_h(url)}' style='display:inline-block;background:{_h(ctx.accent_color)};"
        f"color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;"
        f"font-size:14px;font-weight:600;'>{_h(copy['cta'])} →</a></p>"
    )


def _build_plain_text(
    flow_type: EmailFlowType,
    copy: dict[str, str],
    ctx: EmailContext,
    greeting: str,
    lead: str,
    outro: str,
    footer_html: str,
) -> str:
    lines: list[str] = [greeting, ""]
    lines.append(_strip_html(copy["headline"].format(order_id=ctx.order_id_external)))
    lines.append("")
    lines.append(lead)

    if flow_type == EmailFlowType.shipping_update:
        if ctx.tracking.expected_delivery_date:
            lines.append(_strip_html(copy["eta"].format(eta=ctx.tracking.expected_delivery_date.isoformat())))
        last_event = ctx.tracking.status_detail or ctx.tracking.status
        if last_event:
            tpl = copy["last_event"] if ctx.tracking.location else copy["last_event_no_loc"]
            lines.append(tpl.format(event=last_event, location=ctx.tracking.location or ""))

    if flow_type == EmailFlowType.post_purchase and ctx.items:
        lines.append("")
        lines.append(copy["items_label"] + ":")
        for item in ctx.items:
            extra = f" — {item.variant}" if item.variant else ""
            lines.append(f"  - {item.name}{extra} ×{item.quantity}")
        if ctx.shipping_address_line:
            lines.append("")
            lines.append(copy["address_label"] + ": " + ctx.shipping_address_line)

    if ctx.tracking.tracking_url:
        lines.append("")
        lines.append(copy["cta"] + ": " + ctx.tracking.tracking_url)

    if outro:
        lines.append("")
        lines.append(outro)

    lines.append("")
    lines.append("---")
    lines.append(_strip_html(footer_html))
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _h(value: str | None) -> str:
    if value is None:
        return ""
    return html_lib.escape(str(value), quote=True)


def _strip_html(s: str) -> str:
    import re as _re
    return _re.sub(r"<[^>]+>", "", s)


_HTML_SHELL = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <tr>
          <td style="background:{accent};padding:20px 32px;">
            <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">{shop_name}</span>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <p style="color:#111827;font-size:16px;font-weight:600;margin:0 0 16px;">{greeting}</p>
          <p style="color:#111827;font-size:18px;font-weight:600;margin:0 0 12px;">{headline}</p>
          <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 12px;">{lead}</p>
          {extras_html}
          {blocks_html}
          {cta_html}
          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:24px 0 0;">{outro}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">{footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>""".strip()
