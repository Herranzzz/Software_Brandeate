"""Purchase orders CRUD + lifecycle transitions + receive + replenishment."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import (
    get_accessible_shop_ids,
    get_current_user,
    get_db,
    resolve_shop_scope,
)
from app.models import PurchaseOrder, PurchaseOrderLine, Supplier, User
from app.schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    PurchaseOrderLineRead,
    PurchaseOrderLineUpdate,
    PurchaseOrderListResponse,
    PurchaseOrderRead,
    PurchaseOrderStatusTransition,
    PurchaseOrderUpdate,
    ReceivePOPayload,
    ReplenishmentGenerateRequest,
    ReplenishmentGenerateResponse,
    ReplenishmentRecommendationsResponse,
)
from app.services.purchase_orders import (
    _add_line,
    _recalc_totals,
    create_purchase_order,
    generate_pos_from_recommendations,
    load_po_with_lines,
    receive_purchase_order,
    transition_po_status,
)
from app.services.replenishment_engine import (
    compute_recommendations_for_scope,
    compute_recommendations_for_shop,
)

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])


def _check_shop_access(shop_id: int, accessible_shop_ids: set[int] | None) -> None:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied"
        )


def _to_read(db: Session, po: PurchaseOrder) -> PurchaseOrderRead:
    supplier_name = None
    if po.supplier_id:
        supplier = db.get(Supplier, po.supplier_id)
        supplier_name = supplier.name if supplier else None
    out = PurchaseOrderRead.model_validate(po)
    out.supplier_name = supplier_name
    return out


# ---------------------------------------------------------------------------
# GET /purchase-orders
# ---------------------------------------------------------------------------

@router.get("", response_model=PurchaseOrderListResponse)
def list_purchase_orders(
    response: Response,
    shop_id: int | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    po_status: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> PurchaseOrderListResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = select(PurchaseOrder).options(joinedload(PurchaseOrder.lines))
    if scope is not None:
        q = q.where(PurchaseOrder.shop_id.in_(scope))
    if supplier_id is not None:
        q = q.where(PurchaseOrder.supplier_id == supplier_id)
    if po_status:
        q = q.where(PurchaseOrder.status == po_status)

    total = db.scalar(select(func.count()).select_from(q.subquery()))
    q = (
        q.order_by(PurchaseOrder.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    pos = db.scalars(q).unique().all()

    response.headers["X-Total-Count"] = str(total or 0)
    return PurchaseOrderListResponse(
        purchase_orders=[_to_read(db, p) for p in pos], total=int(total or 0)
    )


# ---------------------------------------------------------------------------
# POST /purchase-orders
# ---------------------------------------------------------------------------

@router.post("", response_model=PurchaseOrderRead, status_code=status.HTTP_201_CREATED)
def create_po(
    payload: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> PurchaseOrderRead:
    _check_shop_access(payload.shop_id, accessible_shop_ids)
    po = create_purchase_order(
        db, payload, created_by_user_id=current_user.id, auto_generated=False
    )
    db.commit()
    po = load_po_with_lines(db, po.id)
    return _to_read(db, po)


# ---------------------------------------------------------------------------
# GET /purchase-orders/{po_id}
# ---------------------------------------------------------------------------

@router.get("/{po_id}", response_model=PurchaseOrderRead)
def get_po(
    po_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> PurchaseOrderRead:
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)
    return _to_read(db, po)


# ---------------------------------------------------------------------------
# PATCH /purchase-orders/{po_id}
# ---------------------------------------------------------------------------

@router.patch("/{po_id}", response_model=PurchaseOrderRead)
def update_po(
    po_id: int,
    payload: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> PurchaseOrderRead:
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)

    if po.status not in ("draft", "sent"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Can only edit PO header while draft or sent",
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(po, field, value)
    po.updated_at = datetime.now(timezone.utc)
    _recalc_totals(po)

    db.commit()
    po = load_po_with_lines(db, po_id)
    return _to_read(db, po)


# ---------------------------------------------------------------------------
# DELETE /purchase-orders/{po_id}   (only draft)
# ---------------------------------------------------------------------------

@router.delete("/{po_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_po(
    po_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> None:
    po = db.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)
    if po.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only draft POs can be deleted; cancel sent/received POs instead",
        )
    db.delete(po)
    db.commit()


# ---------------------------------------------------------------------------
# POST /purchase-orders/{po_id}/status    (transition)
# ---------------------------------------------------------------------------

@router.post("/{po_id}/status", response_model=PurchaseOrderRead)
def transition_status(
    po_id: int,
    payload: PurchaseOrderStatusTransition,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> PurchaseOrderRead:
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)

    transition_po_status(db, po, payload.status, user_id=current_user.id)
    if payload.notes:
        existing = po.notes or ""
        po.notes = f"{existing}\n[{datetime.now(timezone.utc).isoformat()}] {payload.notes}".strip()

    db.commit()
    po = load_po_with_lines(db, po_id)
    return _to_read(db, po)


# ---------------------------------------------------------------------------
# POST /purchase-orders/{po_id}/receive
# ---------------------------------------------------------------------------

@router.post("/{po_id}/receive", response_model=PurchaseOrderRead)
def receive_po(
    po_id: int,
    payload: ReceivePOPayload,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> PurchaseOrderRead:
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)

    receive_purchase_order(db, po, payload, user_id=current_user.id)
    db.commit()
    po = load_po_with_lines(db, po_id)
    return _to_read(db, po)


# ---------------------------------------------------------------------------
# POST /purchase-orders/{po_id}/lines
# ---------------------------------------------------------------------------

@router.post(
    "/{po_id}/lines", response_model=PurchaseOrderLineRead, status_code=status.HTTP_201_CREATED
)
def add_po_line(
    po_id: int,
    payload: PurchaseOrderLineCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> PurchaseOrderLineRead:
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)
    if po.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lines can only be added when PO is in draft",
        )

    line = _add_line(db, po, payload)
    _recalc_totals(po)
    db.commit()
    db.refresh(line)
    return PurchaseOrderLineRead.model_validate(line)


# ---------------------------------------------------------------------------
# PATCH /purchase-orders/{po_id}/lines/{line_id}
# ---------------------------------------------------------------------------

@router.patch("/{po_id}/lines/{line_id}", response_model=PurchaseOrderLineRead)
def update_po_line(
    po_id: int,
    line_id: int,
    payload: PurchaseOrderLineUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> PurchaseOrderLineRead:
    line = db.get(PurchaseOrderLine, line_id)
    if line is None or line.purchase_order_id != po_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Line not found"
        )
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)
    if po.status not in ("draft", "sent", "confirmed"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lines can only be edited when PO is draft/sent/confirmed",
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(line, field, value)
    _recalc_totals(po)
    db.commit()
    db.refresh(line)
    return PurchaseOrderLineRead.model_validate(line)


# ---------------------------------------------------------------------------
# DELETE /purchase-orders/{po_id}/lines/{line_id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{po_id}/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_po_line(
    po_id: int,
    line_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> None:
    line = db.get(PurchaseOrderLine, line_id)
    if line is None or line.purchase_order_id != po_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Line not found"
        )
    po = load_po_with_lines(db, po_id)
    if po is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    _check_shop_access(po.shop_id, accessible_shop_ids)
    if po.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lines can only be deleted from draft POs",
        )

    db.delete(line)
    _recalc_totals(po)
    db.commit()


# ---------------------------------------------------------------------------
# Replenishment: recommendations + auto-generate
# ---------------------------------------------------------------------------

replenishment_router = APIRouter(prefix="/replenishment", tags=["replenishment"])


@replenishment_router.get(
    "/recommendations", response_model=ReplenishmentRecommendationsResponse
)
def get_recommendations(
    shop_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> ReplenishmentRecommendationsResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)
    if scope is None:
        # super-admin with no shop_id filter: compute across all shops (could be expensive)
        # In practice, require shop_id for reasonable scope
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="shop_id is required for replenishment recommendations",
        )
    recs = compute_recommendations_for_scope(db, sorted(scope))
    return ReplenishmentRecommendationsResponse(
        recommendations=recs, total=len(recs), shop_id=shop_id
    )


@replenishment_router.post(
    "/generate", response_model=ReplenishmentGenerateResponse
)
def generate_pos(
    payload: ReplenishmentGenerateRequest,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> ReplenishmentGenerateResponse:
    _check_shop_access(payload.shop_id, accessible_shop_ids)

    recs = compute_recommendations_for_shop(db, payload.shop_id)
    if payload.inventory_item_ids is not None:
        ids_set = set(payload.inventory_item_ids)
        recs = [r for r in recs if r.inventory_item_id in ids_set]

    total_evaluated = len(recs)
    skipped_no_supplier = sum(1 for r in recs if r.primary_supplier_id is None)
    no_consumption = sum(
        1 for r in recs if r.daily_consumption_rate == 0 and r.primary_supplier_id is not None
    )

    pos = generate_pos_from_recommendations(
        db, payload.shop_id, recs, created_by_user_id=current_user.id, auto_generated=False
    )
    db.commit()

    return ReplenishmentGenerateResponse(
        purchase_orders_created=len(pos),
        purchase_order_ids=[p.id for p in pos],
        items_skipped_no_supplier=skipped_no_supplier,
        items_no_consumption=no_consumption,
        total_items_evaluated=total_evaluated,
    )
