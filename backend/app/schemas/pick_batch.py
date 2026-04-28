from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import IncidentPriority, IncidentType, OrderPriority, PickBatchStatus, ProductionStatus


class PickBatchOrderLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    created_at: datetime


class PickBatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int | None
    status: PickBatchStatus
    orders_count: int
    notes: str | None
    created_at: datetime
    orders: list[PickBatchOrderLinkRead]


class OrderBulkProductionStatusUpdate(BaseModel):
    order_ids: list[int] = Field(min_length=1)
    production_status: ProductionStatus


class OrderBulkPriorityUpdate(BaseModel):
    order_ids: list[int] = Field(min_length=1)
    priority: OrderPriority


class OrderBulkIncidentCreate(BaseModel):
    order_ids: list[int] = Field(min_length=1)
    type: IncidentType
    priority: IncidentPriority
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)


class OrderBulkAssign(BaseModel):
    order_ids: list[int] = Field(min_length=1)
    employee_id: int | None = None  # None → unassign


class PickBatchCreate(BaseModel):
    order_ids: list[int] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=5000)
    status: PickBatchStatus = PickBatchStatus.draft
