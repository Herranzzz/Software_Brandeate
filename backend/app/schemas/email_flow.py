from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmailFlowUpdate(BaseModel):
    is_enabled: bool | None = None
    delay_minutes: int | None = Field(default=None, ge=0, le=10080)
    from_name: str | None = Field(default=None, max_length=255)
    from_email: str | None = Field(default=None, max_length=320)
    reply_to: str | None = Field(default=None, max_length=320)
    subject_template: str | None = Field(default=None, max_length=512)

    @field_validator("from_name", "from_email", "reply_to", "subject_template")
    @classmethod
    def strip_nullable(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class EmailFlowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    flow_type: str
    is_enabled: bool
    delay_minutes: int
    from_name: str | None
    from_email: str | None
    reply_to: str | None
    subject_template: str | None
    created_at: datetime
    updated_at: datetime


class EmailFlowLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    flow_type: str
    order_id: int | None
    to_email: str | None
    status: str
    error_message: str | None
    attempts: int
    next_attempt_at: datetime | None
    sent_at: datetime


class EmailFlowDraftRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    order_id: int
    flow_type: str
    locale: str
    model: str
    persona_name: str | None
    subject: str
    body_text: str
    body_html: str
    confidence: float | None
    requires_human_review: bool
    template_subject: str | None
    template_body_text: str | None
    was_sent: bool
    shadow_mode: bool
    error_message: str | None
    generated_at: datetime
