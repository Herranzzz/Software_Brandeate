"""Suppliers CRUD + SupplierProduct management."""

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
from app.models import InventoryItem, Supplier, SupplierProduct, User
from app.schemas.supplier import (
    SupplierCreate,
    SupplierListResponse,
    SupplierProductCreate,
    SupplierProductListResponse,
    SupplierProductRead,
    SupplierProductUpdate,
    SupplierRead,
    SupplierUpdate,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


def _check_shop_access(shop_id: int, accessible_shop_ids: set[int] | None) -> None:
    if accessible_shop_ids is not None and shop_id not in accessible_shop_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied"
        )


def _to_read(db: Session, supplier: Supplier) -> SupplierRead:
    count = db.scalar(
        select(func.count(SupplierProduct.id)).where(
            SupplierProduct.supplier_id == supplier.id
        )
    )
    out = SupplierRead.model_validate(supplier)
    out.products_count = int(count or 0)
    return out


# ---------------------------------------------------------------------------
# GET /suppliers
# ---------------------------------------------------------------------------

@router.get("", response_model=SupplierListResponse)
def list_suppliers(
    response: Response,
    shop_id: int | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierListResponse:
    scope = resolve_shop_scope(shop_id, accessible_shop_ids)

    q = select(Supplier)
    if scope is not None:
        q = q.where(Supplier.shop_id.in_(scope))
    if is_active is not None:
        q = q.where(Supplier.is_active.is_(is_active))

    total = db.scalar(select(func.count()).select_from(q.subquery()))
    q = q.order_by(Supplier.name).offset((page - 1) * per_page).limit(per_page)
    suppliers = db.scalars(q).all()

    response.headers["X-Total-Count"] = str(total or 0)
    return SupplierListResponse(
        suppliers=[_to_read(db, s) for s in suppliers], total=int(total or 0)
    )


# ---------------------------------------------------------------------------
# POST /suppliers
# ---------------------------------------------------------------------------

@router.post("", response_model=SupplierRead, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierRead:
    _check_shop_access(payload.shop_id, accessible_shop_ids)

    data = payload.model_dump()
    supplier = Supplier(**data)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return _to_read(db, supplier)


# ---------------------------------------------------------------------------
# GET /suppliers/{supplier_id}
# ---------------------------------------------------------------------------

@router.get("/{supplier_id}", response_model=SupplierRead)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierRead:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)
    return _to_read(db, supplier)


# ---------------------------------------------------------------------------
# PATCH /suppliers/{supplier_id}
# ---------------------------------------------------------------------------

@router.patch("/{supplier_id}", response_model=SupplierRead)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierRead:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(supplier, field, value)
    supplier.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(supplier)
    return _to_read(db, supplier)


# ---------------------------------------------------------------------------
# DELETE /suppliers/{supplier_id}
# ---------------------------------------------------------------------------

@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> None:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)
    db.delete(supplier)
    db.commit()


# ---------------------------------------------------------------------------
# GET /suppliers/{supplier_id}/products
# ---------------------------------------------------------------------------

@router.get("/{supplier_id}/products", response_model=SupplierProductListResponse)
def list_supplier_products(
    supplier_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierProductListResponse:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)

    rows = db.scalars(
        select(SupplierProduct)
        .options(joinedload(SupplierProduct.inventory_item), joinedload(SupplierProduct.supplier))
        .where(SupplierProduct.supplier_id == supplier_id)
    ).all()

    products: list[SupplierProductRead] = []
    for sp in rows:
        out = SupplierProductRead.model_validate(sp)
        if sp.inventory_item is not None:
            out.inventory_item_sku = sp.inventory_item.sku
            out.inventory_item_name = sp.inventory_item.name
        if sp.supplier is not None:
            out.supplier_name = sp.supplier.name
        products.append(out)

    return SupplierProductListResponse(products=products, total=len(products))


# ---------------------------------------------------------------------------
# POST /suppliers/{supplier_id}/products
# ---------------------------------------------------------------------------

@router.post(
    "/{supplier_id}/products",
    response_model=SupplierProductRead,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_product(
    supplier_id: int,
    payload: SupplierProductCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierProductRead:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)

    if payload.supplier_id != supplier_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path supplier_id does not match payload",
        )

    item = db.get(InventoryItem, payload.inventory_item_id)
    if item is None or item.shop_id != supplier.shop_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="InventoryItem not found for this shop",
        )

    existing = db.scalar(
        select(SupplierProduct).where(
            SupplierProduct.supplier_id == supplier_id,
            SupplierProduct.inventory_item_id == payload.inventory_item_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SupplierProduct already exists for this supplier/item pair",
        )

    sp = SupplierProduct(**payload.model_dump())
    db.add(sp)

    # If marked primary, update InventoryItem.primary_supplier_id too
    if sp.is_primary:
        item.primary_supplier_id = supplier_id
        if sp.cost_price is not None and item.cost_price is None:
            item.cost_price = sp.cost_price

    db.commit()
    db.refresh(sp)

    out = SupplierProductRead.model_validate(sp)
    out.inventory_item_sku = item.sku
    out.inventory_item_name = item.name
    out.supplier_name = supplier.name
    return out


# ---------------------------------------------------------------------------
# PATCH /suppliers/{supplier_id}/products/{product_id}
# ---------------------------------------------------------------------------

@router.patch(
    "/{supplier_id}/products/{product_id}", response_model=SupplierProductRead
)
def update_supplier_product(
    supplier_id: int,
    product_id: int,
    payload: SupplierProductUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> SupplierProductRead:
    sp = db.get(SupplierProduct, product_id)
    if sp is None or sp.supplier_id != supplier_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="SupplierProduct not found"
        )
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sp, field, value)
    sp.updated_at = datetime.now(timezone.utc)

    # Sync primary flag to InventoryItem if toggled
    if payload.is_primary is True:
        item = db.get(InventoryItem, sp.inventory_item_id)
        if item is not None:
            item.primary_supplier_id = supplier_id

    db.commit()
    db.refresh(sp)

    item = db.get(InventoryItem, sp.inventory_item_id)
    out = SupplierProductRead.model_validate(sp)
    if item is not None:
        out.inventory_item_sku = item.sku
        out.inventory_item_name = item.name
    out.supplier_name = supplier.name
    return out


# ---------------------------------------------------------------------------
# DELETE /suppliers/{supplier_id}/products/{product_id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{supplier_id}/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_supplier_product(
    supplier_id: int,
    product_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
    _current_user: User = Depends(get_current_user),
) -> None:
    sp = db.get(SupplierProduct, product_id)
    if sp is None or sp.supplier_id != supplier_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="SupplierProduct not found"
        )
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found"
        )
    _check_shop_access(supplier.shop_id, accessible_shop_ids)

    # Clear primary_supplier_id on the InventoryItem if this was primary
    if sp.is_primary:
        item = db.get(InventoryItem, sp.inventory_item_id)
        if item is not None and item.primary_supplier_id == supplier_id:
            item.primary_supplier_id = None

    db.delete(sp)
    db.commit()
