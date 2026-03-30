from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_accessible_shop_ids, get_db
from app.models import Order, Shipment, TrackingEvent
from app.schemas.shipment import (
    ShipmentCreate,
    ShipmentRead,
    TrackingEventCreate,
    TrackingEventRead,
)
from app.services.orders import sync_order_status_from_tracking


router = APIRouter(prefix="/shipments", tags=["shipments"])


@router.post("", response_model=ShipmentRead, status_code=status.HTTP_201_CREATED)
def create_shipment(
    payload: ShipmentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shipment:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipment))
        .where(Order.id == payload.order_id)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if accessible_shop_ids is not None and order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    if order.shipment is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shipment already exists for this order",
        )

    shipment = Shipment(
        order_id=payload.order_id,
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        tracking_url=payload.tracking_url,
        shipping_status=payload.shipping_status,
        shipping_status_detail=payload.shipping_status_detail,
    )
    sync_order_status_from_tracking(order, "shipment_created")

    db.add(shipment)
    db.commit()
    db.refresh(shipment)
    return db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.events))
        .where(Shipment.id == shipment.id)
    )


@router.get("/{shipment_id}", response_model=ShipmentRead)
def get_shipment(
    shipment_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Shipment:
    shipment = db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.events))
        .where(Shipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    return shipment


@router.get("", response_model=list[ShipmentRead])
def list_shipments(
    shop_id: int | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Shipment]:
    query = select(Shipment).options(selectinload(Shipment.events)).order_by(
        Shipment.created_at.desc(),
        Shipment.id.desc(),
    )
    if accessible_shop_ids is not None and shop_id is not None and shop_id not in accessible_shop_ids:
        return []
    if shop_id is not None:
        query = query.join(Shipment.order).where(Order.shop_id == shop_id)
    elif accessible_shop_ids is not None:
        query = query.join(Shipment.order).where(Order.shop_id.in_(accessible_shop_ids))

    return list(db.scalars(query))


@router.post(
    "/{shipment_id}/events",
    response_model=TrackingEventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_tracking_event(
    shipment_id: int,
    payload: TrackingEventCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> TrackingEvent:
    shipment = db.get(Shipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    if accessible_shop_ids is not None and shipment.order.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")

    event = TrackingEvent(
        shipment_id=shipment_id,
        status_norm=payload.status_norm,
        status_raw=payload.status_raw,
        occurred_at=payload.occurred_at,
    )
    sync_order_status_from_tracking(shipment.order, payload.status_norm)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
