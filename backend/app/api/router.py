from fastapi import APIRouter

from app.api.routes.analytics import router as analytics_router
from app.api.routes.auth import router as auth_router
from app.api.routes.catalog import router as catalog_router
from app.api.routes.customers import router as customers_router
from app.api.routes.health import router as health_router
from app.api.routes.incidents import router as incidents_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.orders import router as orders_router
from app.api.routes.shipments import router as shipments_router
from app.api.routes.shops import router as shops_router
from app.api.routes.tracking import router as tracking_router
from app.api.routes.users import router as users_router
from app.api.routes.webhooks import router as webhooks_router


api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(shops_router)
api_router.include_router(catalog_router)
api_router.include_router(customers_router)
api_router.include_router(analytics_router)
api_router.include_router(orders_router)
api_router.include_router(incidents_router)
api_router.include_router(integrations_router)
api_router.include_router(shipments_router)
api_router.include_router(tracking_router)
api_router.include_router(webhooks_router)
