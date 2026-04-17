from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_admin_user
from app.models import Order, Shipment, User
from app.schemas.ctt import (
    CTTBulkShippingRequest,
    CTTBulkShippingResponse,
    CTTBulkShippingResult,
    CTTCreateAdhocShippingRequest,
    CTTCreateAdhocShippingResponse,
    CTTCreateShippingRequest,
    CTTCreateShippingResponse,
)
from app.core.config import get_settings
from app.services.ctt import CTTError, get_label, get_pod
from app.services.ctt_shipments import (
    CTTShipmentDuplicateError,
    CTTShipmentOrchestrationError,
    create_adhoc_ctt_shipment,
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
        result = create_ctt_shipment_for_order(db=db, order=order, payload=payload, current_user=current_user)
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


@router.post(
    "/shippings/adhoc",
    response_model=CTTCreateAdhocShippingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_ctt_adhoc_shipping(
    payload: CTTCreateAdhocShippingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> CTTCreateAdhocShippingResponse:
    """Create an ADDITIONAL CTT label for an order.

    Does not replace or attach to the order's existing Shipment. Use when
    another package needs to be sent to the same customer/address without
    opening CTT's external software.
    """
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipment).selectinload(Shipment.events))
        .where(Order.id == payload.order_id)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    try:
        result = create_adhoc_ctt_shipment(
            db=db, order=order, payload=payload, current_user=current_user
        )
    except CTTShipmentOrchestrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return CTTCreateAdhocShippingResponse(
        shipping_code=result.shipping_code,
        tracking_url=result.tracking_url,
        ctt_response=result.ctt_response,
    )


@router.post(
    "/shippings/bulk",
    response_model=CTTBulkShippingResponse,
    status_code=status.HTTP_200_OK,
)
def create_ctt_shippings_bulk(
    payload: CTTBulkShippingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> CTTBulkShippingResponse:
    results: list[CTTBulkShippingResult] = []

    for order_id in payload.order_ids:
        order = db.scalar(
            select(Order)
            .options(selectinload(Order.shipment).selectinload(Shipment.events))
            .where(Order.id == order_id)
        )
        if order is None:
            results.append(
                CTTBulkShippingResult(
                    order_id=order_id,
                    status="failed",
                    reason="Pedido no encontrado",
                )
            )
            continue

        has_existing_ctt = (
            order.shipment is not None
            and bool((order.shipment.tracking_number or "").strip())
            and (order.shipment.carrier or "").strip().lower().startswith("ctt")
        )

        if has_existing_ctt:
            results.append(
                CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="skipped",
                    reason="Ya tiene etiqueta CTT creada",
                    shipping_code=order.shipment.tracking_number,
                    tracking_url=order.shipment.tracking_url,
                )
            )
            continue

        shipping_request = CTTCreateShippingRequest(
            order_id=order_id,
            weight_tier_code=payload.weight_tier_code,
            shipping_type_code=payload.shipping_type_code,
            item_count=payload.item_count,
            resolution_mode="automatic",
        )

        try:
            result = create_ctt_shipment_for_order(
                db=db,
                order=order,
                payload=shipping_request,
                current_user=current_user,
            )
            db.commit()
            db.refresh(result.shipment)
            results.append(
                CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="created",
                    shipping_code=result.shipping_code,
                    tracking_url=result.tracking_url,
                )
            )
        except CTTShipmentDuplicateError as exc:
            db.rollback()
            results.append(
                CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="skipped",
                    reason=str(exc),
                    shipping_code=order.shipment.tracking_number if order.shipment else None,
                )
            )
        except CTTShipmentOrchestrationError as exc:
            db.rollback()
            results.append(
                CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="failed",
                    reason=str(exc),
                )
            )

    created_count = sum(1 for r in results if r.status == "created")
    skipped_count = sum(1 for r in results if r.status == "skipped")
    failed_count = sum(1 for r in results if r.status == "failed")

    return CTTBulkShippingResponse(
        results=results,
        created_count=created_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
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


@router.get("/shippings/{tracking_code}/pod")
def get_ctt_pod(
    tracking_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> Response:
    """Return the Proof of Delivery (POD) PDF for a delivered shipment."""
    shipment = db.scalar(
        select(Shipment)
        .options(selectinload(Shipment.order))
        .where(Shipment.tracking_number == tracking_code)
    )
    if shipment is None or shipment.order is None:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    destination_postal_code = (shipment.order.shipping_postal_code or "").strip()
    if not destination_postal_code:
        raise HTTPException(status_code=400, detail="Código postal de destino no disponible")

    settings = get_settings()
    client_center_code = (settings.ctt_client_center_code or "").strip()
    if not client_center_code:
        raise HTTPException(status_code=400, detail="client_center_code no configurado")

    try:
        pdf_bytes = get_pod(tracking_code, client_center_code, destination_postal_code)
    except CTTError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="POD no disponible todavía")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="pod-{tracking_code}.pdf"'},
    )
