from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WebhookEndpointCreate(BaseModel):
    shop_id: int
    url: str = Field(max_length=2048)
    secret: str | None = Field(default=None, max_length=255)
    events: list[str] = Field(default_factory=list)
    is_active: bool = True


class WebhookEndpointUpdate(BaseModel):
    url: str | None = Field(default=None, max_length=2048)
    secret: str | None = None
    events: list[str] | None = None
    is_active: bool | None = None


class WebhookEndpointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    url: str
    secret: str | None = None
    events: list[str]
    is_active: bool
    last_triggered_at: datetime | None = None
    last_status_code: int | None = None
    last_error: str | None = None
    created_at: datetime
