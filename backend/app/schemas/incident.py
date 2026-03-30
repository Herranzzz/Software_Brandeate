from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import IncidentPriority, IncidentStatus, IncidentType


class IncidentOrderSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    external_id: str
    is_personalized: bool
    customer_name: str
    customer_email: str


class IncidentBase(BaseModel):
    type: IncidentType
    priority: IncidentPriority
    status: IncidentStatus = IncidentStatus.open
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    assignee: str | None = Field(default=None, max_length=255)


class IncidentCreate(IncidentBase):
    order_id: int = Field(gt=0)


class IncidentUpdate(BaseModel):
    type: IncidentType | None = None
    priority: IncidentPriority | None = None
    status: IncidentStatus | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    assignee: str | None = Field(default=None, max_length=255)


class IncidentRead(IncidentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    created_at: datetime
    updated_at: datetime
    order: IncidentOrderSummary
