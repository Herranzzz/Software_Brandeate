from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import UserRole
from app.schemas.shop import ShopRead


EmployeeMetricsPeriod = Literal["day", "week"]


class EmployeeAnalyticsRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    shops: list[ShopRead] = Field(default_factory=list)
    labels_today: int = 0
    labels_this_week: int = 0
    total_labels: int = 0
    last_activity_at: datetime | None = None


class EmployeeAnalyticsResponse(BaseModel):
    period: EmployeeMetricsPeriod
    employees: list[EmployeeAnalyticsRow] = Field(default_factory=list)
    generated_at: datetime


class EmployeeActivityItem(BaseModel):
    shipment_id: int
    order_id: int
    order_external_id: str
    carrier: str
    tracking_number: str
    label_created_at: datetime | None = None
    created_at: datetime
    last_activity_at: datetime


class EmployeeActivityResponse(BaseModel):
    employee_id: int
    employee_name: str
    items: list[EmployeeActivityItem] = Field(default_factory=list)
