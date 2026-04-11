from functools import lru_cache

from pydantic import field_validator
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
    # To protect memory on small instances, incremental syncs (scheduler/webhooks/manual sync)
    # use a lower cap than full imports by default.
    shopify_incremental_sync_max_orders: int = 500
    # When enabled, webhooks trigger an immediate sync in the web process.
    # Keeping this disabled by default avoids random RAM spikes on low-memory instances.
    shopify_webhook_immediate_sync_enabled: bool = False
    shopify_webhook_secret: str | None = None
    shopify_ssl_verify: bool = True
    shopify_ssl_cafile: str | None = None
    # Incidents should stay operational and compact by default:
    # - operational list defaults to recent items (unless user asks history)
    # - stale non-resolved incidents are auto-closed after inactivity
    incidents_operational_window_days: int = 14
    incidents_auto_resolve_open_days: int = 14
    incidents_auto_resolve_in_progress_days: int = 30
    # CTT Express
    ctt_client_id: str | None = None
    ctt_client_secret: str | None = None
    ctt_client_center_code: str | None = None
    ctt_user_name: str | None = None
    ctt_password: str | None = None
    ctt_api_base_url: str = "https://api-test.cttexpress.com"
    ctt_default_shipping_type_code: str = "C24"
    ctt_department_code: str = "1"
    ctt_tracking_sync_enabled: bool = True
    ctt_tracking_sync_interval_minutes: int = 15
    ctt_tracking_sync_batch_size: int = 100
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

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        normalized = value.strip()
        if normalized.startswith("postgresql+psycopg://"):
            return normalized
        if normalized.startswith("postgresql://"):
            return f"postgresql+psycopg://{normalized.removeprefix('postgresql://')}"
        if normalized.startswith("postgres://"):
            return f"postgresql+psycopg://{normalized.removeprefix('postgres://')}"
        if normalized.startswith("http://") or normalized.startswith("https://"):
            raise ValueError(
                "DATABASE_URL is invalid. Expected a PostgreSQL connection string like "
                "'postgresql://USER:PASSWORD@HOST:5432/DB' or 'postgres://...'; "
                "received an HTTP(S) URL instead."
            )
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()
