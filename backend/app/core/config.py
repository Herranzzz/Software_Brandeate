from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    auth_secret: str = "dev-secret-change-me"
    cors_origins: list[str] = ["http://localhost:3000"]
    # Poner a True cuando el scheduler corre en un worker separado (worker.py)
    # para que el servidor web no arranque un scheduler duplicado.
    disable_scheduler: bool = False
    shopify_sync_enabled: bool = True
    shopify_sync_interval_minutes: int = 5
    shopify_sync_max_orders: int = 5000
    shopify_webhook_secret: str | None = None
    shopify_ssl_verify: bool = True
    shopify_ssl_cafile: str | None = None

    # CTT Express
    ctt_client_id: str | None = None
    ctt_client_secret: str | None = None
    ctt_client_center_code: str | None = None
    ctt_api_base_url: str = "https://api-test.cttexpress.com"
    ctt_default_shipping_type_code: str = "19H"
    ctt_department_code: str = "1"
    ctt_sender_name: str = ""
    ctt_sender_country_code: str = "ES"
    ctt_sender_postal_code: str = ""
    ctt_sender_address: str = ""
    ctt_sender_town: str = ""
    ctt_ssl_verify: bool = True

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
