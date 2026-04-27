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
    # Interval between incremental scheduler runs. Webhooks handle real-time updates;
    # the scheduler is a safety net — 15 min is plenty.
    shopify_sync_interval_minutes: int = 15
    shopify_sync_max_orders: int = 5000
    # Incremental syncs only need to catch what webhooks missed in the last window.
    # 100 orders is more than enough for a 15-min catch-up on any shop.
    shopify_incremental_sync_max_orders: int = 100
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
    # Filesystem path where label PDFs are cached after first download from CTT.
    # Reprints become a local file read instead of a 20s round-trip. Override
    # via env var LABEL_CACHE_DIR; point at a Render Disk mount for persistence
    # across deploys (otherwise /tmp is wiped on restart, which is fine — labels
    # just get re-fetched once after a deploy).
    label_cache_dir: str = "/tmp/brandeate_labels"
    label_cache_max_age_days: int = 30

    # ── Email agent (LLM) ────────────────────────────────────────────────────
    # When ANTHROPIC_API_KEY is set and email_agent_enabled=True, outbound
    # flow emails are drafted by Claude using EmailContext + the shop persona
    # instead of the static template. If shadow_mode=True the draft is
    # persisted in email_flow_drafts but the customer still receives the
    # template version, so quality can be reviewed before going live.
    anthropic_api_key: str | None = None
    email_agent_enabled: bool = False
    email_agent_shadow_mode: bool = True
    email_agent_model: str = "claude-sonnet-4-6"
    email_agent_max_output_tokens: int = 1024
    email_agent_min_confidence: float = 0.7

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
