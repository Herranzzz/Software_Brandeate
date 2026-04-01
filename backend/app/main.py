from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.services.shopify_scheduler import scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not get_settings().disable_scheduler:
        scheduler.start()
    try:
        yield
    finally:
        if not get_settings().disable_scheduler:
            scheduler.stop()


app = FastAPI(title="3PL Piloto Backend", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

app.include_router(api_router)
