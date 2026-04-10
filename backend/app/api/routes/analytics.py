from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import logging

from app.api.deps import get_accessible_shop_ids, get_db, resolve_shop_scope
from app.models import OrderStatus, ProductionStatus
from app.schemas.analytics import AnalyticsOverviewRead
from app.services.analytics import AnalyticsFilters, build_analytics_overview


router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)

DEFAULT_ANALYTICS_WINDOW_DAYS = 90
MAX_ANALYTICS_WINDOW_DAYS = 365


@router.get("/overview", response_model=AnalyticsOverviewRead)
def get_analytics_overview(
    date_from: date | None = None,
    date_to: date | None = None,
    shop_id: int | None = None,
    channel: str | None = None,
    is_personalized: bool | None = None,
    status: OrderStatus | None = None,
    production_status: ProductionStatus | None = None,
    carrier: str | None = None,
    db: Session = Depends(get_db),
    accessible_shop_ids: set[int] | None = Depends(get_accessible_shop_ids),
):
    today = datetime.now(timezone.utc).date()
    effective_date_to = date_to or today
    effective_date_from = date_from or (effective_date_to - timedelta(days=DEFAULT_ANALYTICS_WINDOW_DAYS - 1))

    if effective_date_from > effective_date_to:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date_from must be before date_to")
    window_days = (effective_date_to - effective_date_from).days + 1
    if window_days > MAX_ANALYTICS_WINDOW_DAYS:
        effective_date_from = effective_date_to - timedelta(days=MAX_ANALYTICS_WINDOW_DAYS - 1)

    scoped_shop_ids = resolve_shop_scope(shop_id, accessible_shop_ids)

    try:
        return build_analytics_overview(
            db=db,
            filters=AnalyticsFilters(
                date_from=effective_date_from,
                date_to=effective_date_to,
                shop_id=next(iter(scoped_shop_ids)) if scoped_shop_ids and len(scoped_shop_ids) == 1 else None,
                channel=channel,
                is_personalized=is_personalized,
                status=status.value if status else None,
                production_status=production_status.value if production_status else None,
                carrier=carrier,
            ),
            accessible_shop_ids=scoped_shop_ids,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to build analytics overview")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to build analytics overview",
        ) from exc
