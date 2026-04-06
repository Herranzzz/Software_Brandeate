import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class IncidentType(str, enum.Enum):
    missing_asset = "missing_asset"
    personalization_error = "personalization_error"
    production_blocked = "production_blocked"
    shipping_exception = "shipping_exception"
    address_issue = "address_issue"
    stock_issue = "stock_issue"


class IncidentPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class IncidentStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        index=True,
    )
    type: Mapped[IncidentType] = mapped_column(
        Enum(
            IncidentType,
            name="incident_type",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    priority: Mapped[IncidentPriority] = mapped_column(
        Enum(
            IncidentPriority,
            name="incident_priority",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    status: Mapped[IncidentStatus] = mapped_column(
        Enum(
            IncidentStatus,
            name="incident_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        default=IncidentStatus.open,
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_automated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    automation_rule_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    order = relationship("Order", back_populates="incidents")
