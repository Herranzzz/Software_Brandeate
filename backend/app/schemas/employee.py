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
    orders_prepared_today: int = 0
    orders_prepared_this_week: int = 0
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


class EmployeeWorkspaceMetrics(BaseModel):
    labels_today: int = 0
    labels_this_week: int = 0
    total_labels: int = 0
    orders_prepared_today: int = 0
    orders_prepared_total: int = 0
    pending_orders_visible: int = 0
    incidents_visible: int = 0
    incidents_assigned: int = 0
    stalled_shipments_visible: int = 0
    designs_ready_visible: int = 0
    recent_orders_handled: int = 0
    last_activity_at: datetime | None = None


class EmployeeWorkspaceRecentItem(BaseModel):
    type: Literal["label", "order_prepared", "incident"]
    title: str
    subtitle: str
    href: str
    timestamp: datetime
    badge: str


class EmployeeWorkspaceResponse(BaseModel):
    employee_id: int
    employee_name: str
    employee_email: str
    role: UserRole
    shop_ids: list[int] = Field(default_factory=list)
    metrics: EmployeeWorkspaceMetrics
    recent_activity: list[EmployeeWorkspaceRecentItem] = Field(default_factory=list)
    generated_at: datetime
