"""LLM-driven email agent.

Generates the body of a flow email using Claude, given a rich
EmailContext and a per-shop persona. Returns subject + plain-text +
HTML so the existing SMTP path can ship it as-is.

Design choices:
  * The agent never invents facts. The system prompt instructs it to
    only reference items, tracking events, ETA, address, etc. that
    appear in the <context> block; if a field is missing it must omit
    that detail, not make one up.
  * Output is JSON — validated with Pydantic so a malformed response
    falls back to the deterministic template instead of breaking the
    flow.
  * Prompt caching: the system prompt + persona are static per shop
    and marked with cache_control. Anthropic invalidates the cache
    when those bytes change, so the cost of repeated sends within a
    5-minute window collapses.
  * Confidence + requires_human_review flags drive the shadow / review
    UI. A low-confidence draft never auto-sends even when shadow_mode
    is off.
  * The HTML body is wrapped in the same shell as the deterministic
    template so visual branding is consistent.
"""

from __future__ import annotations

import html as html_lib
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings
from app.models.email_flow import EmailFlowType
from app.models.shop import Shop
from app.services.email_context import EmailContext
from app.services.email_templates import RenderedEmail, render_email

logger = logging.getLogger(__name__)

_DEFAULT_PERSONA_NAME = "Marta"

_LANG_NAMES = {"es": "Spanish (es)", "en": "English (en)", "pt": "Portuguese (pt)"}


# ──────────────────────────────────────────────────────────────────────────────
# Persona resolution
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Persona:
    name: str
    role: str
    tone: str
    sign_off: str
    extra_guidance: str | None

    @classmethod
    def for_shop(cls, shop: Shop | None) -> "Persona":
        cfg = (shop.marketing_config_json if shop else None) or {}
        persona_cfg = cfg.get("agent_persona") if isinstance(cfg, dict) else None
        if not isinstance(persona_cfg, dict):
            persona_cfg = {}
        return cls(
            name=persona_cfg.get("name") or _DEFAULT_PERSONA_NAME,
            role=persona_cfg.get("role")
                or f"customer care lead at {(shop.name if shop else 'Brandeate')}",
            tone=persona_cfg.get("tone")
                or "warm, concise, human; never corporate or pushy",
            sign_off=persona_cfg.get("sign_off")
                or f"{persona_cfg.get('name') or _DEFAULT_PERSONA_NAME}\n{(shop.name if shop else 'Brandeate')}",
            extra_guidance=persona_cfg.get("extra_guidance"),
        )


# ──────────────────────────────────────────────────────────────────────────────
# Output schema
# ──────────────────────────────────────────────────────────────────────────────

class AgentDraft(BaseModel):
    subject: str = Field(min_length=4, max_length=200)
    body_paragraphs: list[str] = Field(min_length=1, max_length=6)
    cta_label: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    requires_human_review: bool = False
    reasoning_short: str | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class AgentResult:
    rendered: RenderedEmail
    confidence: float
    requires_human_review: bool
    model: str
    persona_name: str
    raw_response: str | None
    error: str | None


def is_agent_enabled() -> bool:
    settings = get_settings()
    return bool(settings.email_agent_enabled and settings.anthropic_api_key)


def generate_agent_email(
    flow_type: EmailFlowType,
    ctx: EmailContext,
    shop: Shop | None,
) -> AgentResult | None:
    """Try to generate a draft with Claude. Returns None on hard failure
    so the caller can fall back to the deterministic template.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None

    try:
        import anthropic  # type: ignore
    except ImportError:
        logger.warning("anthropic SDK not installed — agent disabled")
        return None

    persona = Persona.for_shop(shop)
    system_prompt = _build_system_prompt(persona, flow_type, ctx.locale)
    user_prompt = _build_user_prompt(flow_type, ctx)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    raw_text: str | None = None
    try:
        response = client.messages.create(
            model=settings.email_agent_model,
            max_tokens=settings.email_agent_max_output_tokens,
            temperature=0.4,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_text = _extract_text(response)
        draft = _parse_draft(raw_text)
    except (ValidationError, json.JSONDecodeError) as exc:
        logger.warning("Agent output failed validation: %s", exc)
        return AgentResult(
            rendered=render_email(flow_type, ctx),
            confidence=0.0,
            requires_human_review=True,
            model=settings.email_agent_model,
            persona_name=persona.name,
            raw_response=raw_text,
            error=f"validation: {exc}",
        )
    except Exception as exc:
        logger.warning("Agent call failed: %s", exc)
        return AgentResult(
            rendered=render_email(flow_type, ctx),
            confidence=0.0,
            requires_human_review=True,
            model=settings.email_agent_model,
            persona_name=persona.name,
            raw_response=None,
            error=f"{type(exc).__name__}: {exc}",
        )

    rendered = _render_agent_email(draft, persona, ctx, flow_type)
    return AgentResult(
        rendered=rendered,
        confidence=draft.confidence,
        requires_human_review=draft.requires_human_review
            or draft.confidence < settings.email_agent_min_confidence
            or ctx.has_open_incidents,
        model=settings.email_agent_model,
        persona_name=persona.name,
        raw_response=raw_text,
        error=None,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Prompt construction
# ──────────────────────────────────────────────────────────────────────────────

def _build_system_prompt(persona: Persona, flow_type: EmailFlowType, locale: str) -> str:
    lang_label = _LANG_NAMES.get(locale, "Spanish (es)")
    flow_brief = {
        EmailFlowType.post_purchase.value: (
            "the customer just placed an order. Confirm receipt warmly, "
            "mention the items and shipping address only if listed in <context>, "
            "and tell them they'll get the shipping update in the same thread."
        ),
        EmailFlowType.shipping_update.value: (
            "the order has been picked up by the carrier. Tell the customer "
            "it's on the way, mention the carrier and ETA only if listed in "
            "<context>, and link to the tracking URL when present."
        ),
        EmailFlowType.delivery.value: (
            "the order has just been delivered (or is ready for pickup if it's "
            "a pickup point — see <context>). Confirm delivery, invite them to "
            "reply if anything is wrong."
        ),
    }.get(flow_type.value, "")

    extra = f"\n\nShop-specific guidance: {persona.extra_guidance}" if persona.extra_guidance else ""

    return f"""You are {persona.name}, {persona.role}. You are writing a single, short customer email on behalf of the shop.

CONTEXT FOR THIS FLOW:
{flow_brief}

VOICE & TONE:
- Tone: {persona.tone}.
- Write in {lang_label}. Match the customer's locale; do not switch languages mid-email.
- Sound like a real human writing one quick note, not a marketing template. Vary sentence length. Be specific where context allows.
- Sign off as: {persona.sign_off!r} (use that exact name and shop, no fake titles).

HARD CONSTRAINTS — FAILURE TO FOLLOW MEANS THE EMAIL IS THROWN AWAY:
1. Never invent facts. If a field is not in <context>, do not mention it. No fake tracking numbers, no fake dates, no fake products.
2. Never promise specific delivery dates unless `tracking.expected_delivery_date` is present in <context>.
3. Never apologize for problems unless `open_incidents` lists one. Do not invent delays.
4. Never include placeholder text like "[name]" or "TBD".
5. Do not include the tracking URL or any URL in `body_paragraphs` — the tracking link is rendered as a button using `cta_label`.
6. Do not include greeting or sign-off in `body_paragraphs` — they are rendered automatically.
7. If `open_incidents` is non-empty, acknowledge briefly with empathy and set `requires_human_review=true`.
8. Keep the whole email tight: 2-4 short paragraphs in `body_paragraphs`. No bullet lists.

OUTPUT FORMAT — respond with EXACTLY one JSON object, no prose, no markdown fences:
{{
  "subject": "Short, useful, no clickbait. Include the order id if natural.",
  "body_paragraphs": ["paragraph 1", "paragraph 2", "..."],
  "cta_label": "Short imperative for the tracking button, or null if no tracking URL is in <context>",
  "confidence": 0.0-1.0 — your honest confidence that this email is accurate, on-tone, and safe to auto-send,
  "requires_human_review": true if anything is unusual, ambiguous, or you had to skip context,
  "reasoning_short": "1 sentence on what you decided to mention or skip and why"
}}{extra}"""


def _build_user_prompt(flow_type: EmailFlowType, ctx: EmailContext) -> str:
    payload: dict[str, Any] = {
        "flow_type": flow_type.value,
        "locale": ctx.locale,
        "shop_name": ctx.shop_name,
        "customer": {
            "first_name": ctx.customer_first_name or None,
            "full_name": ctx.customer_full_name,
        },
        "order": {
            "id": ctx.order_id_external,
            "items": [
                {"name": i.name, "qty": i.quantity, "variant": i.variant}
                for i in ctx.items
            ],
            "item_count": ctx.item_count,
            "total": ctx.order_total,
            "currency": ctx.order_currency,
            "shipping_address_line": ctx.shipping_address_line,
            "shipping_city": ctx.shipping_city,
            "shipping_country": ctx.shipping_country,
        },
        "tracking": {
            "carrier": ctx.tracking.carrier,
            "tracking_number": ctx.tracking.tracking_number,
            "tracking_url_present": bool(ctx.tracking.tracking_url),
            "status": ctx.tracking.status,
            "status_detail": ctx.tracking.status_detail,
            "last_event_location": ctx.tracking.location,
            "expected_delivery_date": (
                ctx.tracking.expected_delivery_date.isoformat()
                if ctx.tracking.expected_delivery_date else None
            ),
            "is_pickup_point": ctx.tracking.is_pickup_point,
            "pickup_point_name": ctx.tracking.pickup_point_name,
        },
        "open_incidents": [
            {"type": i.type, "priority": i.priority, "title": i.title}
            for i in ctx.open_incidents
        ],
    }
    return f"<context>\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n</context>"


def _extract_text(response: Any) -> str:
    parts = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts).strip()


def _parse_draft(text: str) -> AgentDraft:
    cleaned = text.strip()
    # Strip ```json … ``` if the model added a fence despite instructions.
    fence = re.match(r"^```(?:json)?\s*(.+?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    data = json.loads(cleaned)
    return AgentDraft.model_validate(data)


# ──────────────────────────────────────────────────────────────────────────────
# HTML rendering of the agent draft
# ──────────────────────────────────────────────────────────────────────────────

def _render_agent_email(
    draft: AgentDraft,
    persona: Persona,
    ctx: EmailContext,
    flow_type: EmailFlowType,
) -> RenderedEmail:
    greeting = (
        f"Hola {ctx.customer_first_name}," if ctx.locale == "es" and ctx.customer_first_name
        else f"Hi {ctx.customer_first_name}," if ctx.locale == "en" and ctx.customer_first_name
        else f"Olá {ctx.customer_first_name}," if ctx.locale == "pt" and ctx.customer_first_name
        else {"es": "Hola,", "en": "Hi,", "pt": "Olá,"}.get(ctx.locale, "Hola,")
    )

    paragraphs_html = "".join(
        f"<p style='color:#374151;font-size:15px;line-height:1.6;margin:0 0 14px;'>{_h(p)}</p>"
        for p in draft.body_paragraphs
    )

    cta_html = ""
    if draft.cta_label and ctx.tracking.tracking_url:
        cta_html = (
            f"<p style='margin:8px 0 0;'>"
            f"<a href='{_h(ctx.tracking.tracking_url)}' style='display:inline-block;"
            f"background:{_h(ctx.accent_color)};color:#fff;text-decoration:none;"
            f"padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;'>"
            f"{_h(draft.cta_label)} →</a></p>"
        )

    sign_off_html = (
        f"<p style='color:#374151;font-size:15px;line-height:1.6;margin:24px 0 0;white-space:pre-line;'>"
        f"{_h(persona.sign_off)}</p>"
    )

    footer = {
        "es": "Logística gestionada por <strong>Brandeate</strong>. Para dejar de recibir, escribe «BAJA» como respuesta.",
        "en": "Logistics handled by <strong>Brandeate</strong>. Reply with “UNSUBSCRIBE” to stop these emails.",
        "pt": "Logística gerida pela <strong>Brandeate</strong>. Responde «CANCELAR» para deixares de receber.",
    }.get(ctx.locale, "Logística gestionada por <strong>Brandeate</strong>.")

    html = _AGENT_HTML_SHELL.format(
        lang=ctx.locale,
        accent=_h(ctx.accent_color),
        shop_name=_h(ctx.shop_name),
        greeting=_h(greeting),
        paragraphs=paragraphs_html,
        cta=cta_html,
        sign_off=sign_off_html,
        footer=footer,
    )

    text_lines = [greeting, ""]
    text_lines.extend(draft.body_paragraphs)
    if draft.cta_label and ctx.tracking.tracking_url:
        text_lines.append("")
        text_lines.append(f"{draft.cta_label}: {ctx.tracking.tracking_url}")
    text_lines.append("")
    text_lines.append(persona.sign_off)
    text_lines.append("")
    text_lines.append("---")
    text_lines.append(re.sub(r"<[^>]+>", "", footer))

    return RenderedEmail(
        subject=draft.subject.strip(),
        html=html,
        text="\n".join(text_lines),
    )


def _h(value: str | None) -> str:
    if value is None:
        return ""
    return html_lib.escape(str(value), quote=True)


_AGENT_HTML_SHELL = """<!DOCTYPE html>
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
          {paragraphs}
          {cta}
          {sign_off}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">{footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>""".strip()
