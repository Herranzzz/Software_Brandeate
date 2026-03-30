from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ShopifyIntegrationCreate(BaseModel):
    shop_id: int = Field(gt=0)
    shop_domain: str = Field(min_length=3, max_length=255)
    access_token: str | None = Field(default=None, max_length=255)
    client_id: str | None = Field(default=None, max_length=255)
    client_secret: str | None = Field(default=None, max_length=255)

    @field_validator("shop_domain")
    @classmethod
    def normalize_shop_domain(cls, value: str) -> str:
        normalized = value.strip().lower()
        normalized = normalized.removeprefix("https://").removeprefix("http://")
        normalized = normalized.rstrip("/")

        if not normalized or "." not in normalized:
            raise ValueError("shop_domain must be a valid Shopify domain")

        return normalized

    @field_validator("access_token")
    @classmethod
    def normalize_access_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        token = value.strip()
        return token or None

    @field_validator("client_id", "client_secret")
    @classmethod
    def normalize_optional_secret_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_credentials_mode(self) -> "ShopifyIntegrationCreate":
        if self.access_token or (self.client_id and self.client_secret):
            return self
        raise ValueError("Provide either access_token or both client_id and client_secret")


class ShopIntegrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    provider: str
    shop_domain: str
    is_active: bool
    last_synced_at: datetime | None
    last_sync_status: str | None
    last_sync_summary: dict | None
    last_error_message: str | None
    created_at: datetime


class ShopifyImportOrdersResult(BaseModel):
    imported_count: int
    updated_count: int
    skipped_count: int
    customers_created_count: int
    customers_updated_count: int
    shipments_created_count: int
    shipments_updated_count: int
    external_ids_migrated_count: int
    tracking_events_created_count: int
    incidents_created_count: int
    total_fetched: int


class ShopifySyncOrdersResult(BaseModel):
    updated_count: int
    imported_count: int
    customers_created_count: int
    customers_updated_count: int
    shipments_created_count: int
    shipments_updated_count: int
    external_ids_migrated_count: int
    tracking_events_created_count: int
    incidents_created_count: int
    total_fetched: int


class ShopIntegrationListResponse(BaseModel):
    integrations: list[ShopIntegrationRead]
