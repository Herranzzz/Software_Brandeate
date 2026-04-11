import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from psycopg.errors import UndefinedTable
from sqlalchemy import func, select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_accessible_shop_ids, get_db, resolve_shop_scope
from app.models.return_ import Return, ReturnStatus
from app.schemas.return_ import ReturnCreate, ReturnRead, ReturnUpdate

logger = logging.getLogger(__name__)

# Shopify order tags pushed when a return status changes
RETURN_STATUS_SHOPIFY_TAGS: dict[str, list[str]] = {
    ReturnStatus.requested:  ["brandeate:devolucion-solicitada"],
    ReturnStatus.approved:   ["brandeate:devolucion-aprobada"],
    ReturnStatus.in_transit: ["brandeate:devolucion-en-transito"],
    ReturnStatus.received:   ["brandeate:devolucion-recibida"],
    ReturnStatus.closed:     ["brandeate:devolucion-cerrada"],
    ReturnStatus.rejected:   ["brandeate:devolucion-rechazada"],
}


router = APIRouter(prefix="/returns", tags=["returns"])

DEFAULT_RETURNS_PER_PAGE = 100
MAX_RETURNS_PER_PAGE = 250


def _return_query():
    return select(Return).options(joinedload(Return.order))


def _is_missing_returns_table_error(exc: Exception) -> bool:
    if isinstance(exc, ProgrammingError) and isinstance(getattr(exc, "orig", None), UndefinedTable):
        return True
    return 'relation "returns" does not exist' in str(exc)


def _returns_feature_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Returns storage is not available yet. Apply backend migrations to enable devoluciones.",
    )


@router.post("", response_model=ReturnRead, status_code=status.HTTP_201_CREATED)
def create_return(
    payload: ReturnCreate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Return:
    if accessible_shop_ids is not None and payload.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    try:
        ret = Return(**payload.model_dump())
        db.add(ret)
        db.commit()
        result = db.scalar(_return_query().where(Return.id == ret.id))
        return result
    except ProgrammingError as exc:
        db.rollback()
        if _is_missing_returns_table_error(exc):
            raise _returns_feature_unavailable() from exc
        raise


@router.get("", response_model=list[ReturnRead])
def list_returns(
    response: Response,
    shop_id: int | None = None,
    status: ReturnStatus | None = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=DEFAULT_RETURNS_PER_PAGE, ge=1, le=MAX_RETURNS_PER_PAGE),
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> list[Return]:
    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)
    query = _return_query().order_by(Return.updated_at.desc(), Return.id.desc())
    count_query = select(func.count()).select_from(Return)
    if status is not None:
        query = query.where(Return.status == status)
        count_query = count_query.where(Return.status == status)
    if scoped_shop_ids is not None:
        query = query.where(Return.shop_id.in_(scoped_shop_ids))
        count_query = count_query.where(Return.shop_id.in_(scoped_shop_ids))
    try:
        total_count = int(db.scalar(count_query) or 0)
        response.headers["X-Total-Count"] = str(total_count)
        safe_per_page = max(1, min(per_page, MAX_RETURNS_PER_PAGE))
        safe_page = max(page, 1)
        query = query.limit(safe_per_page).offset((safe_page - 1) * safe_per_page)
        return list(db.scalars(query))
    except ProgrammingError as exc:
        if _is_missing_returns_table_error(exc):
            return []
        raise


@router.get("/{return_id}", response_model=ReturnRead)
def get_return(
    return_id: int,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Return:
    try:
        ret = db.scalar(_return_query().where(Return.id == return_id))
    except ProgrammingError as exc:
        if _is_missing_returns_table_error(exc):
            raise _returns_feature_unavailable() from exc
        raise
    if ret is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return not found")
    if accessible_shop_ids is not None and ret.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    return ret


@router.patch("/{return_id}", response_model=ReturnRead)
def update_return(
    return_id: int,
    payload: ReturnUpdate,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
) -> Return:
    try:
        ret = db.get(Return, return_id)
    except ProgrammingError as exc:
        if _is_missing_returns_table_error(exc):
            raise _returns_feature_unavailable() from exc
        raise
    if ret is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return not found")
    if accessible_shop_ids is not None and ret.shop_id not in accessible_shop_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop access denied")
    previous_status = ret.status
    try:
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(ret, field, value)
        ret.updated_at = datetime.now(timezone.utc)
        db.commit()
    except ProgrammingError as exc:
        db.rollback()
        if _is_missing_returns_table_error(exc):
            raise _returns_feature_unavailable() from exc
        raise

    # Push Shopify order tags when return status changes
    new_status = ret.status
    if new_status != previous_status and ret.order_id is not None:
        _push_return_status_tags(db=db, ret=ret, new_status=new_status)

    return db.scalar(_return_query().where(Return.id == return_id))


def _push_return_status_tags(*, db: Session, ret: Return, new_status: ReturnStatus) -> None:
    """Push Shopify order tags when a return status changes.
    Never raises — tag sync failures are logged but don't break the API response.
    """
    tags = RETURN_STATUS_SHOPIFY_TAGS.get(new_status)
    if not tags:
        return

    try:
        from app.models import Order, ShopIntegration
        from app.services.shopify import (
            SHOPIFY_PROVIDER,
            add_order_tags_in_shopify,
            resolve_shopify_access_token,
        )
        from sqlalchemy import select as _select

        order = db.get(Order, ret.order_id)
        if order is None or not order.shopify_order_gid:
            logger.debug(
                "Skipping return Shopify tags: no order or no shopify_order_gid for return_id=%s",
                ret.id,
            )
            return

        integration = db.scalar(
            _select(ShopIntegration).where(
                ShopIntegration.shop_id == ret.shop_id,
                ShopIntegration.provider == SHOPIFY_PROVIDER,
                ShopIntegration.is_active.is_(True),
            )
        )
        if integration is None:
            logger.debug(
                "Skipping return Shopify tags: no active integration for shop_id=%s return_id=%s",
                ret.shop_id,
                ret.id,
            )
            return

        access_token = resolve_shopify_access_token(db, integration)
        add_order_tags_in_shopify(
            integration=integration,
            access_token=access_token,
            order_gid=order.shopify_order_gid,
            tags=tags,
        )
        logger.info(
            "Shopify return tags pushed return_id=%s order_id=%s status=%s tags=%s",
            ret.id,
            order.id,
            new_status,
            tags,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Shopify return tag push failed return_id=%s status=%s error=%s",
            ret.id,
            new_status,
            exc,
        )
