from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
