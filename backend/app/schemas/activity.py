from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ActivityLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int | None = None
    entity_type: str
    entity_id: int
    action: str
    actor_id: int | None = None
    actor_name: str | None = None
    summary: str
    detail_json: dict | None = None
    created_at: datetime
    is_deleted: bool = False
    edited_at: datetime | None = None


class CommentEditRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
