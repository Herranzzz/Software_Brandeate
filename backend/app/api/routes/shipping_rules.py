from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db, require_shop_manager_user
from app.models import Order, ShippingRule, User
from app.schemas.shipping_rule import (
    ShippingRuleCreate,
    ShippingRuleRead,
    ShippingRuleResolutionRead,
    ShippingRuleResolutionRequest,
    ShippingRuleUpdate,
)
from app.services.shipping_rules import detect_shipping_rule, list_shipping_rules


router = APIRouter(prefix="/shipping-rules", tags=["shipping-rules"])


@router.get("", response_model=list[ShippingRuleRead])
def get_shipping_rules(
    shop_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[ShippingRule]:
    _assert_shop_access(shop_id, accessible_shop_ids)
    return list_shipping_rules(db, shop_id)


@router.post("", response_model=ShippingRuleRead, status_code=status.HTTP_201_CREATED)
def create_shipping_rule(
    payload: ShippingRuleCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShippingRule:
    _assert_shop_access(payload.shop_id, accessible_shop_ids)
    rule = ShippingRule(
        shop_id=payload.shop_id,
        zone_name=payload.zone_name,
        shipping_rate_name=payload.shipping_rate_name,
        shipping_rate_amount=payload.shipping_rate_amount,
        rule_type=payload.rule_type,
        min_value=payload.min_value,
        max_value=payload.max_value,
        carrier_service_code=payload.carrier_service_code,
        carrier_service_label=payload.carrier_service_label,
        country_codes_json=payload.country_codes,
        province_codes_json=payload.province_codes,
        postal_code_patterns_json=payload.postal_code_patterns,
        is_active=payload.is_active,
        priority=payload.priority,
        notes=payload.notes,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=ShippingRuleRead)
def update_shipping_rule(
    rule_id: int,
    payload: ShippingRuleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShippingRule:
    rule = db.get(ShippingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping rule not found")
    _assert_shop_access(rule.shop_id, accessible_shop_ids)

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "country_codes":
            rule.country_codes_json = value
        elif key == "province_codes":
            rule.province_codes_json = value
        elif key == "postal_code_patterns":
            rule.postal_code_patterns_json = value
        else:
            setattr(rule, key, value)

    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shipping_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager_user),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> None:
    rule = db.get(ShippingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping rule not found")
    _assert_shop_access(rule.shop_id, accessible_shop_ids)
    db.delete(rule)
    db.commit()


@router.post("/resolve", response_model=ShippingRuleResolutionRead)
def resolve_shipping_rule(
    payload: ShippingRuleResolutionRequest,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShippingRuleResolutionRead:
    order = db.get(Order, payload.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    _assert_shop_access(order.shop_id, accessible_shop_ids)

    match = detect_shipping_rule(
        db=db,
        order=order,
        shipping_weight_declared=payload.shipping_weight_declared,
        weight_tier_code=payload.weight_tier_code,
    )
    return ShippingRuleResolutionRead(
        matched=match.matched,
        zone_name=match.zone_name,
        carrier_service_code=match.carrier_service_code,
        carrier_service_label=match.carrier_service_label,
        shipping_rule_id=match.shipping_rule_id,
        shipping_rule_name=match.shipping_rule_name,
        match_reason=match.match_reason,
    )


def _assert_shop_access(shop_id: int, accessible_shop_ids: set[int] | None) -> None:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
