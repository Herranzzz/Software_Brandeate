from __future__ import annotations

import fnmatch
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order, ShippingRule


SPAIN_ISLAND_PROVINCES = {"PM", "IB", "GC", "TF"}
CEUTA_MELILLA_PROVINCES = {"CE", "ML"}


@dataclass
class ShippingRuleMatch:
    matched: bool
    zone_name: str | None = None
    carrier_service_code: str | None = None
    carrier_service_label: str | None = None
    shipping_rule_id: int | None = None
    shipping_rule_name: str | None = None
    match_reason: str | None = None


def list_shipping_rules(db: Session, shop_id: int) -> list[ShippingRule]:
    return list(
        db.scalars(
            select(ShippingRule)
            .where(ShippingRule.shop_id == shop_id)
            .order_by(ShippingRule.priority.asc(), ShippingRule.id.asc())
        )
    )


def detect_shipping_zone(order: Order) -> str:
    country = (order.shipping_country_code or "ES").strip().upper()
    province = (order.shipping_province_code or "").strip().upper()
    postal_code = (order.shipping_postal_code or "").strip().upper()

    if country == "PT":
        return "Portugal"
    if country not in {"ES", ""}:
        return country
    if province in CEUTA_MELILLA_PROVINCES or postal_code.startswith(("51", "52")):
        return "Ceuta y Melilla"
    if province in {"PM", "IB"} or postal_code.startswith("07"):
        return "Baleares"
    if province in {"GC", "TF"} or postal_code.startswith(("35", "38")):
        return "Canarias"
    return "Península"


def detect_shipping_rule(
    *,
    db: Session,
    order: Order,
    shipping_weight_declared: float | None = None,
    weight_tier_code: str | None = None,
) -> ShippingRuleMatch:
    zone_name = detect_shipping_zone(order)
    rules = list_shipping_rules(db, order.shop_id)
    shipping_rate_name = (order.shopify_shipping_rate_name or "").strip().lower()
    shipping_rate_amount = order.shopify_shipping_rate_amount
    effective_weight = shipping_weight_declared or _weight_from_tier(weight_tier_code)

    for rule in rules:
        if not rule.is_active:
            continue
        if (rule.zone_name or "").strip().lower() != zone_name.lower():
            continue
        if not _matches_country(rule, order.shipping_country_code):
            continue
        if not _matches_province(rule, order.shipping_province_code):
            continue
        if not _matches_postal(rule, order.shipping_postal_code):
            continue
        if rule.shipping_rate_name and shipping_rate_name != rule.shipping_rate_name.strip().lower():
            continue
        if rule.shipping_rate_amount is not None and shipping_rate_amount is not None:
            if round(float(rule.shipping_rate_amount), 2) != round(float(shipping_rate_amount), 2):
                continue
        if rule.rule_type == "weight" and not _matches_numeric_range(effective_weight, rule.min_value, rule.max_value):
            continue
        if rule.rule_type == "price" and not _matches_numeric_range(shipping_rate_amount, rule.min_value, rule.max_value):
            continue

        rule_name = rule.shipping_rate_name or rule.zone_name
        return ShippingRuleMatch(
            matched=True,
            zone_name=zone_name,
            carrier_service_code=rule.carrier_service_code,
            carrier_service_label=rule.carrier_service_label or rule.carrier_service_code,
            shipping_rule_id=rule.id,
            shipping_rule_name=rule_name,
            match_reason=_build_match_reason(rule, shipping_rate_name, shipping_rate_amount, effective_weight),
        )

    return ShippingRuleMatch(
        matched=False,
        zone_name=zone_name,
        match_reason=f"Sin regla activa para {zone_name}. Se usará el fallback configurado.",
    )


def resolve_ctt_service(
    *,
    db: Session,
    order: Order,
    requested_service_code: str | None,
    requested_rule_id: int | None,
    requested_zone: str | None,
    resolution_mode: str | None,
    shipping_weight_declared: float | None = None,
    weight_tier_code: str | None = None,
) -> ShippingRuleMatch:
    auto_match = detect_shipping_rule(
        db=db,
        order=order,
        shipping_weight_declared=shipping_weight_declared,
        weight_tier_code=weight_tier_code,
    )

    normalized_mode = (resolution_mode or "automatic").strip().lower()
    if requested_service_code and (
        normalized_mode == "manual" or requested_service_code != (auto_match.carrier_service_code or requested_service_code)
    ):
        manual_rule_name = auto_match.shipping_rule_name if requested_rule_id == auto_match.shipping_rule_id else None
        return ShippingRuleMatch(
            matched=True,
            zone_name=requested_zone or auto_match.zone_name,
            carrier_service_code=requested_service_code,
            carrier_service_label=requested_service_code,
            shipping_rule_id=requested_rule_id,
            shipping_rule_name=manual_rule_name,
            match_reason="Servicio ajustado manualmente por operaciones.",
        )

    return auto_match


def _matches_country(rule: ShippingRule, country_code: str | None) -> bool:
    if not rule.country_codes_json:
        return True
    normalized = (country_code or "ES").strip().upper()
    return normalized in rule.country_codes_json


def _matches_province(rule: ShippingRule, province_code: str | None) -> bool:
    if not rule.province_codes_json:
        return True
    normalized = (province_code or "").strip().upper()
    return normalized in rule.province_codes_json


def _matches_postal(rule: ShippingRule, postal_code: str | None) -> bool:
    if not rule.postal_code_patterns_json:
        return True
    normalized = (postal_code or "").strip().upper()
    return any(fnmatch.fnmatch(normalized, pattern.upper()) for pattern in rule.postal_code_patterns_json)


def _matches_numeric_range(value: float | None, min_value: float | None, max_value: float | None) -> bool:
    if value is None:
        return min_value is None and max_value is None
    if min_value is not None and value < float(min_value):
        return False
    if max_value is not None and value > float(max_value):
        return False
    return True


def _weight_from_tier(weight_tier_code: str | None) -> float | None:
    if not weight_tier_code:
        return None
    suffix = weight_tier_code.removeprefix("band_")
    if not suffix.isdigit():
        return None
    return int(suffix) / 1000


def _build_match_reason(
    rule: ShippingRule,
    shipping_rate_name: str,
    shipping_rate_amount: float | None,
    effective_weight: float | None,
) -> str:
    if rule.rule_type == "weight":
        return f"Match por zona y peso ({effective_weight or 0:g} kg)."
    if shipping_rate_name:
        return f"Match por zona y tarifa Shopify \"{shipping_rate_name}\"."
    if shipping_rate_amount is not None:
        return f"Match por zona y precio de envío {shipping_rate_amount:.2f}."
    return "Match por zona configurada."
