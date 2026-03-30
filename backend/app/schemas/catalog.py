from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ShopCatalogProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    provider: str
    external_product_id: str
    title: str
    handle: str | None
    vendor: str | None
    product_type: str | None
    status: str | None
    image_url: str | None
    variants_json: list[dict] | None
    is_personalizable: bool
    synced_at: datetime | None
    created_at: datetime


class ShopCatalogProductListResponse(BaseModel):
    products: list[ShopCatalogProductRead]


class ShopCatalogProductUpdate(BaseModel):
    is_personalizable: bool


class ShopifyCatalogSyncResult(BaseModel):
    fetched_count: int
    created_count: int
    updated_count: int
