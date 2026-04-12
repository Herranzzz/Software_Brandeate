from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_user, require_shop_manager_user, get_accessible_shop_ids
from app.models.carrier_config import CarrierConfig
from app.models.user import User
from app.services.carriers import get_all_carriers

router = APIRouter(prefix="/carrier-configs", tags=["carrier-configs"])


class CarrierConfigRead(BaseModel):
    id: int
    shop_id: int
    carrier_code: str
    carrier_name: str
    is_enabled: bool
    config_json: dict | None

    class Config:
        from_attributes = True


class CarrierConfigUpsert(BaseModel):
    shop_id: int
    carrier_code: str
    is_enabled: bool = True
    config_json: dict | None = None


class CarrierInfo(BaseModel):
    code: str
    name: str
    supports_live_rates: bool
    supports_label_creation: bool
    supports_tracking: bool


@router.get("/available", response_model=list[CarrierInfo])
def list_available_carriers(
    _user: User = Depends(require_admin_user),
):
    """List all carrier integrations available in this installation."""
    return [
        CarrierInfo(
            code=c.code,
            name=c.name,
            supports_live_rates=c.supports_live_rates,
            supports_label_creation=c.supports_label_creation,
            supports_tracking=c.supports_tracking,
        )
        for c in get_all_carriers()
    ]


@router.get("", response_model=list[CarrierConfigRead])
def list_carrier_configs(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    query = select(CarrierConfig).order_by(CarrierConfig.carrier_code)
    if shop_id is not None:
        query = query.where(CarrierConfig.shop_id == shop_id)
    configs = list(db.scalars(query))

    # Enrich with carrier names
    carriers = {c.code: c.name for c in get_all_carriers()}
    result = []
    for cfg in configs:
        result.append(CarrierConfigRead(
            id=cfg.id,
            shop_id=cfg.shop_id,
            carrier_code=cfg.carrier_code,
            carrier_name=carriers.get(cfg.carrier_code, cfg.carrier_code),
            is_enabled=cfg.is_enabled,
            config_json=cfg.config_json,
        ))
    return result


@router.put("", response_model=CarrierConfigRead)
def upsert_carrier_config(
    body: CarrierConfigUpsert,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin_user),
):
    existing = db.scalar(
        select(CarrierConfig)
        .where(CarrierConfig.shop_id == body.shop_id)
        .where(CarrierConfig.carrier_code == body.carrier_code)
    )
    if existing:
        existing.is_enabled = body.is_enabled
        if body.config_json is not None:
            existing.config_json = body.config_json
        db.commit()
        db.refresh(existing)
        cfg = existing
    else:
        cfg = CarrierConfig(
            shop_id=body.shop_id,
            carrier_code=body.carrier_code,
            is_enabled=body.is_enabled,
            config_json=body.config_json,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    carriers = {c.code: c.name for c in get_all_carriers()}
    return CarrierConfigRead(
        id=cfg.id,
        shop_id=cfg.shop_id,
        carrier_code=cfg.carrier_code,
        carrier_name=carriers.get(cfg.carrier_code, cfg.carrier_code),
        is_enabled=cfg.is_enabled,
        config_json=cfg.config_json,
    )
