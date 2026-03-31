from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_user
from app.core.config import get_settings
from app.models import Order, User
from app.schemas.ctt import CTTCreateShippingRequest, CTTCreateShippingResponse
from app.services.ctt import CTTError, create_shipping, get_label


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
    order = db.get(Order, payload.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    settings = get_settings()
    if not settings.ctt_client_center_code:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CTT Express no está configurado (CTT_CLIENT_CENTER_CODE ausente)",
        )

    shipping_date = payload.shipping_date or date.today().isoformat()
    shipping_type_code = payload.shipping_type_code or settings.ctt_default_shipping_type_code

    # CTT auto-generates the shipping_code when client_bar_code is empty
    items: list[dict]
    if payload.items:
        items = [
            {
                "item_synonym_code": "",
                "item_weight_declared": item.item_weight_declared,
                **({"item_length_declared": item.item_length_declared} if item.item_length_declared else {}),
                **({"item_width_declared": item.item_width_declared} if item.item_width_declared else {}),
                **({"item_height_declared": item.item_height_declared} if item.item_height_declared else {}),
            }
            for item in payload.items
        ]
    else:
        items = [{"item_synonym_code": "", "item_weight_declared": payload.shipping_weight_declared}]

    shipping_data: dict = {
        "client_bar_code": "",
        "client_center_code": settings.ctt_client_center_code,
        "shipping_type_code": shipping_type_code,
        "client_references": [order.external_id],
        "shipping_weight_declared": payload.shipping_weight_declared,
        "item_count": payload.item_count,
        "sender_name": settings.ctt_sender_name,
        "sender_country_code": settings.ctt_sender_country_code,
        "sender_postal_code": settings.ctt_sender_postal_code,
        "sender_address": settings.ctt_sender_address,
        "sender_town": settings.ctt_sender_town,
        "recipient_name": payload.recipient_name,
        "recipient_country_code": payload.recipient_country_code,
        "recipient_postal_code": payload.recipient_postal_code,
        "recipient_address": payload.recipient_address,
        "recipient_town": payload.recipient_town,
        "recipient_phones": payload.recipient_phones,
        "shipping_date": shipping_date,
        "items": items,
    }
    if payload.recipient_email:
        shipping_data["recipient_email_notify_address"] = payload.recipient_email

    try:
        ctt_response = create_shipping(shipping_data)
    except CTTError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    # CTT returns the generated shipping_code nested under shipping_data
    result_code = (
        (ctt_response.get("shipping_data") or {}).get("shipping_code")
        or ctt_response.get("shipping_code")
        or ""
    )
    return CTTCreateShippingResponse(shipping_code=result_code, ctt_response=ctt_response)


@router.get("/shippings/{tracking_code}/label")
def get_ctt_label(
    tracking_code: str,
    label_type: str = "PDF",
    current_user: User = Depends(require_admin_user),
) -> Response:
    try:
        pdf_bytes = get_label(tracking_code, label_type)
    except CTTError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="label-{tracking_code}.pdf"'},
    )
