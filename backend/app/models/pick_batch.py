import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PickBatchStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"


class PickBatch(Base):
    __tablename__ = "pick_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[PickBatchStatus] = mapped_column(
        Enum(
            PickBatchStatus,
            name="pick_batch_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        nullable=False,
        default=PickBatchStatus.draft,
        server_default=PickBatchStatus.draft.value,
        index=True,
    )
    orders_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    shop = relationship("Shop")
    orders = relationship(
        "PickBatchOrder",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="PickBatchOrder.id",
    )


class PickBatchOrder(Base):
    __tablename__ = "pick_batch_orders"
    __table_args__ = (
        UniqueConstraint("batch_id", "order_id", name="uq_pick_batch_orders_batch_order"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("pick_batches.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    batch = relationship("PickBatch", back_populates="orders")
    order = relationship("Order")
