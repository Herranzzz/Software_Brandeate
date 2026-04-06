from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_admin_user
from app.models import Order, Shipment, User
from app.schemas.ctt import CTTCreateShippingRequest, CTTCreateShippingResponse
from app.services.ctt import CTTError, get_label
from app.services.ctt_shipments import (
    CTTShipmentDuplicateError,
    CTTShipmentOrchestrationError,
    create_ctt_shipment_for_order,
)


router = APIRouter(prefix="/ctt", tags=["ctt"])


@router.post(
    "/shippings",
    response_model=CTTCreateShippingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_ctt_shipping(
    payload: CTTCreateShippingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> CTTCreateShippingResponse:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipment).selectinload(Shipment.events))
        .where(Order.id == payload.order_id)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    try:
        result = create_ctt_shipment_for_order(db=db, order=order, payload=payload)
        db.commit()
        db.refresh(result.shipment)
    except CTTShipmentDuplicateError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except CTTShipmentOrchestrationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return CTTCreateShippingResponse(
        shipping_code=result.shipping_code,
        tracking_url=result.tracking_url,
        shopify_sync_status=result.shopify_sync_status,
        shipment=result.shipment,
        ctt_response=result.ctt_response,
    )


@router.get("/shippings/{tracking_code}/label")
def get_ctt_label(
    tracking_code: str,
    label_type: str = "PDF",
    model_type: str = "SINGLE",
    current_user: User = Depends(require_admin_user),
) -> Response:
    try:
        file_bytes = get_label(tracking_code, label_type, model_type)
    except CTTError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    normalized_type = (label_type or "PDF").upper()
    media_type = "application/pdf"
    extension = "pdf"

    if normalized_type == "ZPL":
        media_type = "text/plain; charset=utf-8"
        extension = "zpl"
    elif normalized_type == "EPL":
        media_type = "text/plain; charset=utf-8"
        extension = "epl"

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="label-{tracking_code}.{extension}"'},
    )
