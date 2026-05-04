import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_admin_user
from app.db.session import SessionLocal
from app.models import Order, Shipment, User
from app.schemas.ctt import (
    CTTBulkShippingRequest,
    CTTBulkShippingResponse,
    CTTBulkShippingResult,
    CTTCreateShippingRequest,
    CTTCreateShippingResponse,
    CTTReplacementShippingRequest,
    CTTReplacementShippingResponse,
)
from app.core.config import get_settings
from app.services.ctt import CTTError, get_label, get_pod
from app.services.ctt_shipments import (
    CTTShipmentDuplicateError,
    CTTShipmentOrchestrationError,
    create_ctt_shipment_for_order,
)
from app.services.label_cache import get_cached_label, store_label
from app.services.shopify import cancel_shopify_fulfillment


logger = logging.getLogger(__name__)

# Cap concurrent outbound CTT calls. Render's starter instances cap at ~512 MB;
# each CTT thread keeps a DB session + response buffer in memory, so 8 workers
# caused OOM crashes under load. 3 is enough to finish a typical batch in well
# under a minute while keeping peak memory safe.
_BULK_CTT_CONCURRENCY = 3


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
    # Row-level lock on the order: if a parallel request is already creating a
    # label for this order (double-click, two operators clicking at once),
    # this blocks until the first commits. The first writes the shipment, the
    # second sees it via the `has tracking_number` short-circuit inside the
    # orchestrator and returns the existing label instead of creating a dup.
    locked_order_id = db.scalar(
        select(Order.id).where(Order.id == payload.order_id).with_for_update()
    )
    if locked_order_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipments).selectinload(Shipment.events))
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
    "/shippings/{order_id}/replacements",
    response_model=CTTReplacementShippingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_ctt_replacement_shipping(
    order_id: int,
    payload: CTTReplacementShippingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> CTTReplacementShippingResponse:
    locked_order_id = db.scalar(
        select(Order.id).where(Order.id == order_id).with_for_update()
    )
    if locked_order_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")

    order = db.scalar(
        select(Order)
        .options(selectinload(Order.shipments).selectinload(Shipment.events))
        .where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")

    active_shipment = order.shipment
    if active_shipment is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El pedido no tiene ningún envío CTT activo para reemplazar",
        )

    shopify_previous_fulfillment_cancelled = False
    fulfillment_id = active_shipment.fulfillment_id
    if fulfillment_id:
        cancelled = cancel_shopify_fulfillment(db=db, order=order, fulfillment_id=fulfillment_id)
        if cancelled:
            active_shipment.shopify_fulfillment_cancelled_at = datetime.now(timezone.utc)
            shopify_previous_fulfillment_cancelled = True

    shipping_request = CTTCreateShippingRequest(
        order_id=order_id,
        weight_tier_code=payload.weight_tier_code or active_shipment.weight_tier_code,
        shipping_type_code=payload.shipping_type_code or active_shipment.shipping_type_code,
        item_count=payload.item_count,
        resolution_mode="automatic",
    )

    try:
        result = create_ctt_shipment_for_order(
            db=db,
            order=order,
            payload=shipping_request,
            current_user=current_user,
            replacement_reason=payload.replacement_reason,
        )
        db.commit()
        db.refresh(result.shipment)
    except CTTShipmentOrchestrationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return CTTReplacementShippingResponse(
        shipping_code=result.shipping_code,
        tracking_url=result.tracking_url,
        shopify_sync_status=result.shopify_sync_status,
        shopify_previous_fulfillment_cancelled=shopify_previous_fulfillment_cancelled,
        shipment=result.shipment,
        replaced_shipment_id=active_shipment.id,
        ctt_response=result.ctt_response,
    )


@router.post(
    "/shippings/bulk",
    response_model=CTTBulkShippingResponse,
    status_code=status.HTTP_200_OK,
)
def create_ctt_shippings_bulk(
    payload: CTTBulkShippingRequest,
    current_user: User = Depends(require_admin_user),
) -> CTTBulkShippingResponse:
    """Create CTT shipments for many orders in parallel.

    Each order runs in its own thread with its own DB session so a slow CTT
    response for one order doesn't block the others. Concurrency is bounded to
    avoid hammering CTT (they throttle) and to leave headroom for other
    requests on the server.
    """

    def _process_one(order_id: int, actor_id: int) -> CTTBulkShippingResult:
        session: Session = SessionLocal()
        try:
            # Reload the user in this thread's session to avoid cross-session
            # attribute access on the request-scoped user.
            actor = session.get(User, actor_id)
            order = session.scalar(
                select(Order)
                .options(selectinload(Order.shipments).selectinload(Shipment.events))
                .where(Order.id == order_id)
            )
            if order is None:
                return CTTBulkShippingResult(
                    order_id=order_id,
                    status="failed",
                    reason="Pedido no encontrado",
                )

            has_existing_ctt = (
                order.shipment is not None
                and bool((order.shipment.tracking_number or "").strip())
                and (order.shipment.carrier or "").strip().lower().startswith("ctt")
            )
            if has_existing_ctt:
                return CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="skipped",
                    reason="Ya tiene etiqueta CTT creada",
                    shipping_code=order.shipment.tracking_number,
                    tracking_url=order.shipment.tracking_url,
                )

            shipping_request = CTTCreateShippingRequest(
                order_id=order_id,
                weight_tier_code=payload.weight_tier_code,
                shipping_type_code=payload.shipping_type_code,
                item_count=payload.item_count,
                resolution_mode="automatic",
            )

            try:
                result = create_ctt_shipment_for_order(
                    db=session,
                    order=order,
                    payload=shipping_request,
                    current_user=actor,
                )
                session.commit()
                session.refresh(result.shipment)
                return CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="created",
                    shipping_code=result.shipping_code,
                    tracking_url=result.tracking_url,
                )
            except CTTShipmentDuplicateError as exc:
                session.rollback()
                return CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="skipped",
                    reason=str(exc),
                    shipping_code=order.shipment.tracking_number if order.shipment else None,
                )
            except CTTShipmentOrchestrationError as exc:
                session.rollback()
                return CTTBulkShippingResult(
                    order_id=order_id,
                    external_id=order.external_id,
                    status="failed",
                    reason=str(exc),
                )
        except Exception as exc:  # defensive: never lose a row from the result set
            logger.exception("Bulk CTT worker crashed for order_id=%s", order_id)
            try:
                session.rollback()
            except Exception:
                pass
            return CTTBulkShippingResult(
                order_id=order_id,
                status="failed",
                reason=f"Error interno: {exc}",
            )
        finally:
            session.close()

    results: list[CTTBulkShippingResult] = []
    max_workers = min(_BULK_CTT_CONCURRENCY, max(len(payload.order_ids), 1))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_process_one, order_id, current_user.id): order_id
            for order_id in payload.order_ids
        }
        for future in as_completed(futures):
            results.append(future.result())

    # Preserve the caller's order_ids ordering for predictable UI rendering.
    order_index = {oid: i for i, oid in enumerate(payload.order_ids)}
    results.sort(key=lambda r: order_index.get(r.order_id, 0))

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
    normalized_type = (label_type or "PDF").upper()
    normalized_model = (model_type or "SINGLE").upper()

    file_bytes = get_cached_label(tracking_code, normalized_type, normalized_model)
    if file_bytes is None:
        try:
            file_bytes = get_label(tracking_code, label_type, model_type)
        except CTTError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        store_label(tracking_code, normalized_type, normalized_model, file_bytes)

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
