from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    auth_secret: str = "dev-secret-change-me"
    shopify_sync_enabled: bool = True
    shopify_sync_interval_minutes: int = 5
    shopify_sync_max_orders: int = 5000
    shopify_webhook_secret: str | None = None
    shopify_ssl_verify: bool = True
    shopify_ssl_cafile: str | None = None

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
