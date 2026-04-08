import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    ops_admin = "ops_admin"
    shop_admin = "shop_admin"
    shop_viewer = "shop_viewer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user_shops = relationship(
        "UserShop",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="UserShop.id",
    )
    created_shipments = relationship(
        "Shipment",
        back_populates="created_by_employee",
        foreign_keys="Shipment.created_by_employee_id",
        order_by="desc(Shipment.label_created_at), desc(Shipment.created_at), desc(Shipment.id)",
    )


class UserShop(Base):
    __tablename__ = "user_shops"
    __table_args__ = (
        UniqueConstraint("user_id", "shop_id", name="uq_user_shops_user_shop"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)

    user = relationship("User", back_populates="user_shops")
    shop = relationship("Shop", back_populates="user_shops")
