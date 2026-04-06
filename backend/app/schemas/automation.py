from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import AutomationActionType, AutomationEntityType


class AutomationEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    order_id: int | None
    shipment_id: int | None
    entity_type: AutomationEntityType
    entity_id: int
    rule_name: str
    action_type: AutomationActionType
    summary: str
    payload_json: dict | list | None
    created_at: datetime
