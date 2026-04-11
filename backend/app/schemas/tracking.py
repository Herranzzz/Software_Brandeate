from datetime import datetime

from pydantic import BaseModel

from app.models import Order, Shipment, TrackingEvent


class PublicTrackingShopRead(BaseModel):
    id: int
    name: str
    slug: str
    tracking_config: dict | None = None


class PublicTrackingOrderRead(BaseModel):
    id: int
    external_id: str
    status: str
    customer_name: str
    customer_email: str
    created_at: datetime


class PublicTrackingShipmentRead(BaseModel):
    id: int
    carrier: str
    tracking_number: str
    tracking_url: str | None
    shipping_status: str | None
    public_token: str
    created_at: datetime


class PublicTrackingEventRead(BaseModel):
    id: int
    status_norm: str
    status_raw: str | None
    source: str | None
    location: str | None
    occurred_at: datetime
    created_at: datetime


class PublicTrackingRead(BaseModel):
    order: PublicTrackingOrderRead
    shipment: PublicTrackingShipmentRead
    tracking_events: list[PublicTrackingEventRead]
    shop: PublicTrackingShopRead | None = None

    @classmethod
    def from_models(
        cls,
        shipment: Shipment,
        order: Order,
        events: list[TrackingEvent],
        shop=None,
    ) -> "PublicTrackingRead":
        shop_data: PublicTrackingShopRead | None = None
        if shop is not None:
            shop_data = PublicTrackingShopRead(
                id=shop.id,
                name=shop.name,
                slug=shop.slug,
                tracking_config=shop.tracking_config_json,
            )
        return cls(
            order=PublicTrackingOrderRead(
                id=order.id,
                external_id=order.external_id,
                status=order.status.value,
                customer_name=order.customer_name,
                customer_email=order.customer_email,
                created_at=order.created_at,
            ),
            shipment=PublicTrackingShipmentRead(
                id=shipment.id,
                carrier=shipment.carrier,
                tracking_number=shipment.tracking_number,
                tracking_url=shipment.tracking_url,
                shipping_status=shipment.shipping_status,
                public_token=shipment.public_token,
                created_at=shipment.created_at,
            ),
            tracking_events=[
                PublicTrackingEventRead(
                    id=event.id,
                    status_norm=event.status_norm,
                    status_raw=event.status_raw,
                    source=event.source,
                    location=event.location,
                    occurred_at=event.occurred_at,
                    created_at=event.created_at,
                )
                for event in events
            ],
            shop=shop_data,
        )
