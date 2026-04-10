from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_accessible_shop_ids, get_db, resolve_shop_scope
from app.models import ShopCustomer
from app.schemas.customer import ShopCustomerListResponse


router = APIRouter(prefix="/customers", tags=["customers"])

DEFAULT_CUSTOMERS_PER_PAGE = 100
MAX_CUSTOMERS_PER_PAGE = 250


@router.get("", response_model=ShopCustomerListResponse)
def list_customers(
    response: Response,
    shop_id: int | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=DEFAULT_CUSTOMERS_PER_PAGE, ge=1, le=MAX_CUSTOMERS_PER_PAGE),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> ShopCustomerListResponse:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    query = select(ShopCustomer).order_by(
        ShopCustomer.last_order_at.desc(),
        ShopCustomer.created_at.desc(),
        ShopCustomer.id.desc(),
    )
    count_query = select(func.count()).select_from(ShopCustomer)

    if scoped_shop_ids is not None:
        query = query.where(ShopCustomer.shop_id.in_(scoped_shop_ids))
        count_query = count_query.where(ShopCustomer.shop_id.in_(scoped_shop_ids))

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
        count_query = count_query.where(
            or_(
                ShopCustomer.name.ilike(search),
                ShopCustomer.email.ilike(search),
                ShopCustomer.phone.ilike(search),
                ShopCustomer.external_customer_id.ilike(search),
            )
        )

    total_count = int(db.scalar(count_query) or 0)
    response.headers["X-Total-Count"] = str(total_count)
    safe_per_page = max(1, min(per_page, MAX_CUSTOMERS_PER_PAGE))
    safe_page = max(page, 1)
    query = query.limit(safe_per_page).offset((safe_page - 1) * safe_per_page)

    return ShopCustomerListResponse(customers=list(db.scalars(query)))
