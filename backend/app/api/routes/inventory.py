"""Inventory SGA — FastAPI router for WMS operations."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import (
    get_accessible_shop_ids,
    get_current_user,
    get_db,
    require_admin_user,
    resolve_shop_scope,
)
from app.models import ShopCatalogVariant, User
from app.services.shopify import (
    ShopifyCredentialsError,
    ShopifyIntegrationNotFoundError,
    ShopifyServiceError,
    sync_shopify_catalog_for_shop,
)
from app.models.inventory import (
    InboundShipment,
    InboundShipmentLine,
    InventoryItem,
    StockMovement,
)
from app.models.shop_integration import ShopIntegration
from app.schemas.inventory import (
    InboundReceivePayload,
    InboundShipmentCreate,
    InboundShipmentLineCreate,
    InboundShipmentLineRead,
    InboundShipmentLineUpdate,
    InboundShipmentListResponse,
    InboundShipmentRead,
    InboundShipmentUpdate,
    InventoryAlertsRead,
    InventoryItemCreate,
    InventoryItemListResponse,
    InventoryItemRead,
    InventoryItemUpdate,
    CatalogSyncResult,
    InventoryShopifySyncResult,
    InventorySyncStatusRead,
    StockAdjustPayload,
    StockMovementListResponse,
    StockMovementRead,
)
from app.services.inventory_sync import sync_inventory_from_shopify as _run_shopify_sync

router = APIRouter(prefix="/inventory", tags=["inventory"])

# ---------------------------------------------------------------------------
# Status transition rules for InboundShipment
# ---------------------------------------------------------------------------

_INBOUND_STATUS_ORDER = ["draft", "sent", "in_transit", "received", "closed"]
_INBOUND_STATUS_RANK = {s: i for i, s in enumerate(_INBOUND_STATUS_ORDER)}


def _validate_status_transition(current: str, new: str) -> None:
    current_rank = _INBOUND_STATUS_RANK.get(current, -1)
    new_rank = _INBOUND_STATUS_RANK.get(new, -1)
    if new_rank < current_rank:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot transition shipment status from '{current}' back to '{new}'",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_shipment_or_404(db: Session, shipment_id: int) -> InboundShipment:
    shipment = db.scalar(
        select(InboundShipment)
        .options(
            joinedload(InboundShipment.lines).joinedload(InboundShipmentLine.inventory_item)
        )
        .where(InboundShipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    return shipment


def _check_shop_access(shop_id: int, accessible_shop_ids: set[int] | None) -> None:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")


def _find_or_create_inventory_item(
    db: Session,
    shop_id: int,
    sku: str,
    name: str | None,
    created_by_user_id: int | None = None,
) -> InventoryItem:
    item = db.scalar(
        select(InventoryItem).where(
            InventoryItem.shop_id == shop_id, InventoryItem.sku == sku
        )
    )
    if item is None:
        item = InventoryItem(
            shop_id=shop_id,
            sku=sku,
            name=name or sku,
            stock_on_hand=0,
        )
        db.add(item)
        db.flush()
    return item


def _create_stock_movement(
    db: Session,
    *,
    item: InventoryItem,
    qty_delta: int,
    movement_type: str,
    reference_type: str | None = None,
    reference_id: int | None = None,
    notes: str | None = None,
    performed_by_user_id: int | None = None,
) -> StockMovement:
    qty_before = item.stock_on_hand
    qty_after = qty_before + qty_delta
    movement = StockMovement(
        shop_id=item.shop_id,
        inventory_item_id=item.id,
        sku=item.sku,
        movement_type=movement_type,
        qty_delta=qty_delta,
        qty_before=qty_before,
        qty_after=qty_after,
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
        performed_by_user_id=performed_by_user_id,
    )
    db.add(movement)
    item.stock_on_hand = qty_after
    item.updated_at = datetime.now(timezone.utc)
    return movement


# ---------------------------------------------------------------------------
# GET /inventory/items
# ---------------------------------------------------------------------------

@router.get("/items", response_model=InventoryItemListResponse)
def list_inventory_items(
    response: Response,
    shop_id: int | None = Query(default=None),
    low_stock: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InventoryItemListResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = select(InventoryItem)
    if scope is not None:
        q = q.where(InventoryItem.shop_id.in_(scope))

    if low_stock:
        q = q.where(
            InventoryItem.reorder_point.is_not(None),
            InventoryItem.stock_on_hand <= InventoryItem.reorder_point,
        )

    total = db.scalar(select(func.count()).select_from(q.subquery()))

    # Order: items with reorder_point null last, then by sku
    q = (
        q.order_by(
            InventoryItem.reorder_point.is_(None),
            InventoryItem.sku,
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    items = db.scalars(q).all()
    response.headers["X-Total-Count"] = str(total)
    return InventoryItemListResponse(
        items=[InventoryItemRead.model_validate(i) for i in items],
        total=total or 0,
    )


# ---------------------------------------------------------------------------
# POST /inventory/items
# ---------------------------------------------------------------------------

@router.post("/items", response_model=InventoryItemRead, status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    payload: InventoryItemCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> InventoryItemRead:
    _check_shop_access(payload.shop_id, accessible_shop_ids)

    existing = db.scalar(
        select(InventoryItem).where(
            InventoryItem.shop_id == payload.shop_id,
            InventoryItem.sku == payload.sku,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"InventoryItem with SKU '{payload.sku}' already exists for this shop",
        )

    item = InventoryItem(
        shop_id=payload.shop_id,
        sku=payload.sku,
        name=payload.name,
        variant_id=payload.variant_id,
        stock_on_hand=payload.stock_on_hand,
        reorder_point=payload.reorder_point,
        reorder_qty=payload.reorder_qty,
        location=payload.location,
        notes=payload.notes,
    )
    db.add(item)
    db.flush()

    if payload.stock_on_hand > 0:
        _create_stock_movement(
            db,
            item=item,
            qty_delta=payload.stock_on_hand,
            movement_type="adjustment_add",
            notes="Initial stock on creation",
            performed_by_user_id=current_user.id,
        )
        # stock_on_hand was already set to initial value; reset after movement recalculation
        item.stock_on_hand = payload.stock_on_hand

    db.commit()
    db.refresh(item)
    return InventoryItemRead.model_validate(item)


# ---------------------------------------------------------------------------
# GET /inventory/items/{item_id}
# ---------------------------------------------------------------------------

@router.get("/items/{item_id}", response_model=InventoryItemRead)
def get_inventory_item(
    item_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InventoryItemRead:
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="InventoryItem not found")
    _check_shop_access(item.shop_id, accessible_shop_ids)

    # Load recent movements (last 50)
    db.scalars(
        select(StockMovement)
        .where(StockMovement.inventory_item_id == item_id)
        .order_by(StockMovement.created_at.desc())
        .limit(50)
    ).all()

    return InventoryItemRead.model_validate(item)


# ---------------------------------------------------------------------------
# PATCH /inventory/items/{item_id}
# ---------------------------------------------------------------------------

@router.patch("/items/{item_id}", response_model=InventoryItemRead)
def update_inventory_item(
    item_id: int,
    payload: InventoryItemUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InventoryItemRead:
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="InventoryItem not found")
    _check_shop_access(item.shop_id, accessible_shop_ids)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(item)
    return InventoryItemRead.model_validate(item)


# ---------------------------------------------------------------------------
# POST /inventory/items/{item_id}/adjust
# ---------------------------------------------------------------------------

_ALLOWED_ADJUSTMENT_TYPES = frozenset({
    "adjustment_add",
    "adjustment_remove",
    "damage_write_off",
    "cycle_count",
    "return_receipt",
})


@router.post("/items/{item_id}/adjust", response_model=InventoryItemRead)
def adjust_stock(
    item_id: int,
    payload: StockAdjustPayload,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> InventoryItemRead:
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="InventoryItem not found")
    _check_shop_access(item.shop_id, accessible_shop_ids)

    if payload.movement_type not in _ALLOWED_ADJUSTMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"movement_type must be one of: {', '.join(sorted(_ALLOWED_ADJUSTMENT_TYPES))}",
        )

    _create_stock_movement(
        db,
        item=item,
        qty_delta=payload.qty_delta,
        movement_type=payload.movement_type,
        notes=payload.notes,
        performed_by_user_id=current_user.id,
    )

    db.commit()
    db.refresh(item)
    return InventoryItemRead.model_validate(item)


# ---------------------------------------------------------------------------
# GET /inventory/inbound
# ---------------------------------------------------------------------------

@router.get("/inbound", response_model=InboundShipmentListResponse)
def list_inbound_shipments(
    response: Response,
    shop_id: int | None = Query(default=None),
    shipment_status: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InboundShipmentListResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = select(InboundShipment).options(joinedload(InboundShipment.lines))
    if scope is not None:
        q = q.where(InboundShipment.shop_id.in_(scope))
    if shipment_status:
        q = q.where(InboundShipment.status == shipment_status)

    total = db.scalar(select(func.count()).select_from(q.subquery()))

    q = q.order_by(InboundShipment.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    shipments = db.scalars(q).unique().all()

    response.headers["X-Total-Count"] = str(total)
    return InboundShipmentListResponse(
        shipments=[InboundShipmentRead.model_validate(s) for s in shipments],
        total=total or 0,
    )


# ---------------------------------------------------------------------------
# POST /inventory/inbound
# ---------------------------------------------------------------------------

@router.post("/inbound", response_model=InboundShipmentRead, status_code=status.HTTP_201_CREATED)
def create_inbound_shipment(
    payload: InboundShipmentCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(get_current_user),
) -> InboundShipmentRead:
    _check_shop_access(payload.shop_id, accessible_shop_ids)

    shipment = InboundShipment(
        shop_id=payload.shop_id,
        reference=payload.reference,
        status=payload.status,
        expected_arrival=payload.expected_arrival,
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        notes=payload.notes,
        created_by_user_id=current_user.id,
    )
    db.add(shipment)
    db.commit()
    return _get_shipment_read(db, shipment.id)


# ---------------------------------------------------------------------------
# GET /inventory/inbound/{shipment_id}
# ---------------------------------------------------------------------------

@router.get("/inbound/{shipment_id}", response_model=InboundShipmentRead)
def get_inbound_shipment(
    shipment_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InboundShipmentRead:
    shipment = _get_shipment_or_404(db, shipment_id)
    _check_shop_access(shipment.shop_id, accessible_shop_ids)
    return InboundShipmentRead.model_validate(shipment)


# ---------------------------------------------------------------------------
# PATCH /inventory/inbound/{shipment_id}
# ---------------------------------------------------------------------------

@router.patch("/inbound/{shipment_id}", response_model=InboundShipmentRead)
def update_inbound_shipment(
    shipment_id: int,
    payload: InboundShipmentUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InboundShipmentRead:
    shipment = _get_shipment_or_404(db, shipment_id)
    _check_shop_access(shipment.shop_id, accessible_shop_ids)

    updates = payload.model_dump(exclude_unset=True)

    if "status" in updates:
        _validate_status_transition(shipment.status, updates["status"])

    for field, value in updates.items():
        setattr(shipment, field, value)
    shipment.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _get_shipment_read(db, shipment_id)


# ---------------------------------------------------------------------------
# POST /inventory/inbound/{shipment_id}/lines
# ---------------------------------------------------------------------------

@router.post(
    "/inbound/{shipment_id}/lines",
    response_model=InboundShipmentLineRead,
    status_code=status.HTTP_201_CREATED,
)
def add_inbound_shipment_line(
    shipment_id: int,
    payload: InboundShipmentLineCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InboundShipmentLineRead:
    shipment = db.get(InboundShipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    _check_shop_access(shipment.shop_id, accessible_shop_ids)

    if shipment.status not in {"draft", "sent"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lines can only be added when shipment status is 'draft' or 'sent'",
        )

    # Find or create the matching InventoryItem
    item = _find_or_create_inventory_item(db, shipment.shop_id, payload.sku, payload.name)

    line = InboundShipmentLine(
        inbound_shipment_id=shipment_id,
        inventory_item_id=item.id,
        sku=payload.sku,
        name=payload.name,
        qty_expected=payload.qty_expected,
        notes=payload.notes,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    return InboundShipmentLineRead.model_validate(line)


# ---------------------------------------------------------------------------
# PATCH /inventory/inbound/{shipment_id}/lines/{line_id}
# ---------------------------------------------------------------------------

@router.patch("/inbound/{shipment_id}/lines/{line_id}", response_model=InboundShipmentLineRead)
def update_inbound_shipment_line(
    shipment_id: int,
    line_id: int,
    payload: InboundShipmentLineUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InboundShipmentLineRead:
    line = db.get(InboundShipmentLine, line_id)
    if line is None or line.inbound_shipment_id != shipment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line not found")

    shipment = db.get(InboundShipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    _check_shop_access(shipment.shop_id, accessible_shop_ids)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(line, field, value)

    db.commit()
    db.refresh(line)
    return InboundShipmentLineRead.model_validate(line)


# ---------------------------------------------------------------------------
# DELETE /inventory/inbound/{shipment_id}/lines/{line_id}
# ---------------------------------------------------------------------------

@router.delete(
    "/inbound/{shipment_id}/lines/{line_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_inbound_shipment_line(
    shipment_id: int,
    line_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> None:
    line = db.get(InboundShipmentLine, line_id)
    if line is None or line.inbound_shipment_id != shipment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line not found")

    shipment = db.get(InboundShipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    _check_shop_access(shipment.shop_id, accessible_shop_ids)

    if shipment.status not in {"draft", "sent"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lines can only be deleted when shipment status is 'draft' or 'sent'",
        )

    db.delete(line)
    db.commit()


# ---------------------------------------------------------------------------
# POST /inventory/inbound/{shipment_id}/receive
# ---------------------------------------------------------------------------

@router.post("/inbound/{shipment_id}/receive", response_model=InboundShipmentRead)
def receive_inbound_shipment(
    shipment_id: int,
    payload: InboundReceivePayload,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    current_user: User = Depends(require_admin_user),
) -> InboundShipmentRead:
    shipment = db.get(InboundShipment, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    _check_shop_access(shipment.shop_id, accessible_shop_ids)

    if shipment.status not in {"in_transit", "sent"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Shipment must be in 'sent' or 'in_transit' status to receive",
        )

    now = datetime.now(timezone.utc)

    # Index existing lines by id for quick lookup
    lines_by_id: dict[int, InboundShipmentLine] = {}
    for line in db.scalars(
        select(InboundShipmentLine).where(
            InboundShipmentLine.inbound_shipment_id == shipment_id
        )
    ).all():
        lines_by_id[line.id] = line

    for recv in payload.lines:
        line = lines_by_id.get(recv.line_id)
        if line is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Line {recv.line_id} not found in shipment {shipment_id}",
            )

        line.qty_received = recv.qty_received
        line.qty_accepted = recv.qty_accepted
        line.qty_rejected = recv.qty_rejected
        line.rejection_reason = recv.rejection_reason

        if recv.qty_accepted > 0:
            item = _find_or_create_inventory_item(
                db, shipment.shop_id, line.sku, line.name, current_user.id
            )
            # Link line to item if not already linked
            if line.inventory_item_id is None:
                line.inventory_item_id = item.id

            _create_stock_movement(
                db,
                item=item,
                qty_delta=recv.qty_accepted,
                movement_type="inbound_receipt",
                reference_type="inbound_shipment",
                reference_id=shipment_id,
                performed_by_user_id=current_user.id,
            )

    shipment.status = "received"
    shipment.received_at = now
    shipment.received_by_user_id = current_user.id
    shipment.updated_at = now

    if payload.notes:
        shipment.notes = payload.notes

    db.commit()
    return _get_shipment_read(db, shipment_id)


# ---------------------------------------------------------------------------
# GET /inventory/movements
# ---------------------------------------------------------------------------

@router.get("/movements", response_model=StockMovementListResponse)
def list_stock_movements(
    response: Response,
    shop_id: int | None = Query(default=None),
    sku: str | None = Query(default=None),
    item_id: int | None = Query(default=None),
    movement_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> StockMovementListResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = select(StockMovement)
    if scope is not None:
        q = q.where(StockMovement.shop_id.in_(scope))
    if sku:
        q = q.where(StockMovement.sku == sku)
    if item_id is not None:
        q = q.where(StockMovement.inventory_item_id == item_id)
    if movement_type:
        q = q.where(StockMovement.movement_type == movement_type)

    total = db.scalar(select(func.count()).select_from(q.subquery()))

    q = q.order_by(StockMovement.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    movements = db.scalars(q).all()

    response.headers["X-Total-Count"] = str(total)
    return StockMovementListResponse(
        movements=[StockMovementRead.model_validate(m) for m in movements],
        total=total or 0,
    )


# ---------------------------------------------------------------------------
# GET /inventory/alerts
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=InventoryAlertsRead)
def get_inventory_alerts(
    shop_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> InventoryAlertsRead:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = (
        select(InventoryItem)
        .where(
            InventoryItem.reorder_point.is_not(None),
            InventoryItem.stock_on_hand <= InventoryItem.reorder_point,
            InventoryItem.is_active.is_(True),
        )
        .order_by((InventoryItem.stock_on_hand - InventoryItem.reorder_point).asc())
    )
    if scope is not None:
        q = q.where(InventoryItem.shop_id.in_(scope))

    items = db.scalars(q).all()
    return InventoryAlertsRead(
        items=[InventoryItemRead.model_validate(i) for i in items],
        total=len(items),
    )


# ---------------------------------------------------------------------------
# Internal helper: fetch shipment with full joins for response serialization
# ---------------------------------------------------------------------------

def _get_shipment_read(db: Session, shipment_id: int) -> InboundShipmentRead:
    shipment = db.scalar(
        select(InboundShipment)
        .options(
            joinedload(InboundShipment.lines).joinedload(InboundShipmentLine.inventory_item)
        )
        .where(InboundShipment.id == shipment_id)
    )
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    return InboundShipmentRead.model_validate(shipment)


# ---------------------------------------------------------------------------
# POST /inventory/sync-from-catalog
# ---------------------------------------------------------------------------

@router.post("/sync-from-catalog", response_model=CatalogSyncResult)
def sync_inventory_from_catalog(
    shop_id: int = Query(..., description="Shop to sync catalog SKUs into inventory"),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> CatalogSyncResult:
    """Import all Shopify catalog variants (that have a SKU) as InventoryItem records.

    First pulls the latest product catalog from Shopify (so the local
    ShopCatalogVariant table is up-to-date), then creates InventoryItem records
    for any variant that has a SKU and doesn't already exist.

    Already-existing items are left untouched (stock, reorder_point, location are
    preserved). Only new SKUs are created with stock_on_hand=0.
    """
    _check_shop_access(shop_id, accessible_shop_ids)

    # ── Step 1: pull latest catalog from Shopify ────────────────────────────
    try:
        sync_shopify_catalog_for_shop(db, shop_id)
    except ShopifyIntegrationNotFoundError:
        # No Shopify integration configured — skip the live fetch, fall back to
        # whatever is already in ShopCatalogVariant.
        pass
    except (ShopifyCredentialsError, ShopifyServiceError):
        # Credentials invalid or Shopify unreachable — best-effort: continue
        # with existing local catalog data.
        pass

    # ── Step 2: import variants into InventoryItem ─────────────────────────
    # Fetch all catalog variants with a non-empty SKU for this shop
    variants = db.scalars(
        select(ShopCatalogVariant).where(
            ShopCatalogVariant.shop_id == shop_id,
            ShopCatalogVariant.sku.is_not(None),
            ShopCatalogVariant.sku != "",
        )
    ).all()

    total_variants = len(variants)
    skipped_no_sku = 0
    created = 0
    already_existed = 0

    for variant in variants:
        sku = (variant.sku or "").strip()
        if not sku:
            skipped_no_sku += 1
            continue

        existing = db.scalar(
            select(InventoryItem).where(
                InventoryItem.shop_id == shop_id,
                InventoryItem.sku == sku,
            )
        )
        if existing is not None:
            # Link variant_id if not already linked
            if existing.variant_id is None:
                existing.variant_id = variant.id
            already_existed += 1
            continue

        # Determine a human-readable name: prefer product title + variant title
        product = variant.product
        name_parts = []
        if product and product.title:
            name_parts.append(product.title)
        if variant.title and variant.title.lower() not in ("default title", "default"):
            name_parts.append(variant.title)
        name = " · ".join(name_parts) if name_parts else sku

        item = InventoryItem(
            shop_id=shop_id,
            sku=sku,
            name=name,
            variant_id=variant.id,
            stock_on_hand=0,
        )
        db.add(item)
        created += 1

    db.commit()

    return CatalogSyncResult(
        created=created,
        already_existed=already_existed,
        skipped_no_sku=skipped_no_sku,
        total_variants=total_variants,
    )


# ---------------------------------------------------------------------------
# POST /inventory/sync-from-shopify
# ---------------------------------------------------------------------------

@router.post("/sync-from-shopify", response_model=InventoryShopifySyncResult)
def sync_inventory_from_shopify(
    shop_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> InventoryShopifySyncResult:
    """Pull inventory_quantity from Shopify and update stock_on_hand for matching SKUs.

    If shop_id is omitted all active Shopify integrations are synced; only the
    first result is returned in that case (use /inventory/sync-status for a
    per-shop overview).
    """
    results = _run_shopify_sync(shop_id=shop_id, db=db)

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No active Shopify integration found for shop_id={shop_id}"
                if shop_id
                else "No active Shopify integrations found"
            ),
        )

    # Merge all results into one aggregate response
    merged_shop_id = shop_id if shop_id is not None else results[0].shop_id
    total_synced = sum(r.synced for r in results)
    total_created = sum(r.created for r in results)
    total_skipped = sum(r.skipped for r in results)
    total_errors = sum(r.errors for r in results)
    all_error_details: list[str] = [d for r in results for d in r.error_details]

    if total_errors == 0:
        merged_status = "success"
    elif total_synced > 0 or total_created > 0:
        merged_status = "partial"
    else:
        merged_status = "failed"

    return InventoryShopifySyncResult(
        shop_id=merged_shop_id,
        synced=total_synced,
        created=total_created,
        skipped=total_skipped,
        errors=total_errors,
        error_details=all_error_details,
        sync_status=merged_status,
        synced_at=results[0].synced_at,
    )


# ---------------------------------------------------------------------------
# GET /inventory/sync-status
# ---------------------------------------------------------------------------

@router.get("/sync-status", response_model=list[InventorySyncStatusRead])
def get_inventory_sync_status(
    shop_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
) -> list[InventorySyncStatusRead]:
    """Return last Shopify inventory sync metadata for each active integration."""
    from app.models.shop import Shop  # local import to avoid circular deps

    q = select(ShopIntegration).where(
        ShopIntegration.provider == "shopify",
        ShopIntegration.is_active.is_(True),
    )
    if shop_id is not None:
        q = q.where(ShopIntegration.shop_id == shop_id)

    integrations = db.scalars(q).all()

    output: list[InventorySyncStatusRead] = []
    for integration in integrations:
        shop = db.get(Shop, integration.shop_id)
        shop_name = shop.name if shop else f"Shop #{integration.shop_id}"
        output.append(
            InventorySyncStatusRead(
                shop_id=integration.shop_id,
                shop_name=shop_name,
                last_synced_at=integration.last_synced_at,
                last_sync_status=integration.last_sync_status,
                last_sync_summary=integration.last_sync_summary,
                last_error_message=integration.last_error_message,
            )
        )

    return output
