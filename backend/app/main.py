from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.observability import RequestTimingMiddleware, install_slow_query_logger
from app.services.ctt_tracking_scheduler import scheduler as ctt_tracking_scheduler
from app.services.email_flow_scheduler import start as email_flow_start, stop as email_flow_stop
from app.services.replenishment_scheduler import start as replenishment_start, stop as replenishment_stop
from app.services.shopify_scheduler import scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not get_settings().disable_scheduler:
        scheduler.start()
        ctt_tracking_scheduler.start()
        email_flow_start()
        replenishment_start()
    try:
        yield
    finally:
        if not get_settings().disable_scheduler:
            replenishment_stop()
            email_flow_stop()
            ctt_tracking_scheduler.stop()
            scheduler.stop()


app = FastAPI(title="Brandeate app Backend", lifespan=lifespan)

install_slow_query_logger()

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Response-Time-Ms"],
)
app.add_middleware(RequestTimingMiddleware)

app.include_router(api_router)
