from fastapi import APIRouter

from app.api.routes.activity import router as activity_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.returns import router as returns_router
from app.api.routes.auth import router as auth_router
from app.api.routes.catalog import router as catalog_router
from app.api.routes.ctt import router as ctt_router
from app.api.routes.customers import router as customers_router
from app.api.routes.health import router as health_router
from app.api.routes.incidents import router as incidents_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.orders import router as orders_router
from app.api.routes.shipping_options import router as shipping_options_router
from app.api.routes.shipping_rules import router as shipping_rules_router
from app.api.routes.shipments import router as shipments_router
from app.api.routes.shops import router as shops_router
from app.api.routes.tracking import router as tracking_router
from app.api.routes.users import router as users_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.invoices import router as invoices_router
from app.api.routes.webhook_endpoints import router as webhook_endpoints_router
from app.api.routes.webhooks import router as webhooks_router
from app.api.routes.carrier_configs import router as carrier_configs_router
from app.api.routes.email_flows import router as email_flows_router


api_router = APIRouter()
api_router.include_router(activity_router)
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
api_router.include_router(shipping_options_router)
api_router.include_router(shipping_rules_router)
api_router.include_router(ctt_router)
api_router.include_router(tracking_router)
api_router.include_router(returns_router)
api_router.include_router(webhook_endpoints_router)
api_router.include_router(webhooks_router)
api_router.include_router(inventory_router)
api_router.include_router(invoices_router)
api_router.include_router(carrier_configs_router)
api_router.include_router(email_flows_router)
