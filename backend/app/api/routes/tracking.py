from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_db
from app.models import Shipment, Shop, TrackingEvent
from app.schemas.tracking import PublicTrackingRead


router = APIRouter(tags=["tracking"])


@router.get("/t/{public_token}", response_model=PublicTrackingRead, status_code=status.HTTP_200_OK)
def get_public_tracking(public_token: str, db: Session = Depends(get_db)) -> PublicTrackingRead:
    shipment = db.scalar(
        select(Shipment)
        .options(
            joinedload(Shipment.order),
            selectinload(Shipment.events),
        )
        .where(Shipment.public_token == public_token)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracking not found")

    latest_events = list(
        db.scalars(
            select(TrackingEvent)
            .where(TrackingEvent.shipment_id == shipment.id)
            .order_by(TrackingEvent.occurred_at.desc(), TrackingEvent.id.desc())
            .limit(10)
        )
    )

    shop = db.get(Shop, shipment.order.shop_id) if shipment.order else None

    return PublicTrackingRead.from_models(shipment=shipment, order=shipment.order, events=latest_events, shop=shop)
