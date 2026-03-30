from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db, resolve_shop_scope
from app.models import ShopCustomer
from app.schemas.customer import ShopCustomerListResponse


router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=ShopCustomerListResponse)
def list_customers(
    shop_id: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopCustomerListResponse:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    query = select(ShopCustomer).order_by(
        ShopCustomer.last_order_at.desc(),
        ShopCustomer.created_at.desc(),
        ShopCustomer.id.desc(),
    )

    if scoped_shop_ids is not None:
        query = query.where(ShopCustomer.shop_id.in_(scoped_shop_ids))

    normalized_query = (q or "").strip()
    if normalized_query:
        search = f"%{normalized_query}%"
        query = query.where(
            or_(
                ShopCustomer.name.ilike(search),
                ShopCustomer.email.ilike(search),
                ShopCustomer.phone.ilike(search),
                ShopCustomer.external_customer_id.ilike(search),
            )
        )

    return ShopCustomerListResponse(customers=list(db.scalars(query)))
