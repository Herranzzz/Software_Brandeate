"""users auth

Revision ID: 0007_users_auth
Revises: 0006_order_is_personalized
Create Date: 2026-03-29 00:30:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_users_auth"
down_revision: Union[str, Sequence[str], None] = "0006_order_is_personalized"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


user_role = sa.Enum(
    "super_admin",
    "ops_admin",
    "shop_admin",
    "shop_viewer",
    name="user_role",
    native_enum=False,
    create_constraint=True,
)


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "user_shops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "shop_id", name="uq_user_shops_user_shop"),
    )
    op.create_index(op.f("ix_user_shops_user_id"), "user_shops", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_shops_shop_id"), "user_shops", ["shop_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_shops_shop_id"), table_name="user_shops")
    op.drop_index(op.f("ix_user_shops_user_id"), table_name="user_shops")
    op.drop_table("user_shops")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    user_role.drop(bind, checkfirst=True)
