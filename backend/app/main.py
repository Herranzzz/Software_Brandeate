from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.router import api_router
from app.services.shopify_scheduler import scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    scheduler.start()
    try:
        yield
    finally:
        scheduler.stop()


app = FastAPI(title="3PL Piloto Backend", lifespan=lifespan)
app.include_router(api_router)
