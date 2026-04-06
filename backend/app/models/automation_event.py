import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


json_type = JSON().with_variant(JSONB, "postgresql")


class AutomationEntityType(str, enum.Enum):
    order = "order"
    shipment = "shipment"


class AutomationActionType(str, enum.Enum):
    flag_detected = "flag_detected"
    incident_created = "incident_created"
    priority_raised = "priority_raised"


class AutomationEvent(Base):
    __tablename__ = "automation_events"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_automation_events_fingerprint"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=True)
    shipment_id: Mapped[int | None] = mapped_column(ForeignKey("shipments.id", ondelete="CASCADE"), index=True, nullable=True)
    entity_type: Mapped[AutomationEntityType] = mapped_column(
        Enum(
            AutomationEntityType,
            name="automation_entity_type",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    rule_name: Mapped[str] = mapped_column(String(120), index=True)
    action_type: Mapped[AutomationActionType] = mapped_column(
        Enum(
            AutomationActionType,
            name="automation_action_type",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    summary: Mapped[str] = mapped_column(String(255))
    payload_json: Mapped[dict | list | None] = mapped_column(json_type, nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="automation_events")
    order = relationship("Order", back_populates="automation_events")
    shipment = relationship("Shipment", back_populates="automation_events")
