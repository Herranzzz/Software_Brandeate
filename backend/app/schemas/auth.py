from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import UserRole
from app.schemas.shop import ShopRead


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserShopAssignment(BaseModel):
    shop_id: int = Field(gt=0)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=255)
    role: UserRole
    is_active: bool = True
    shop_ids: list[int] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, min_length=3, max_length=320)
    password: str | None = Field(default=None, min_length=6, max_length=255)
    role: UserRole | None = None
    is_active: bool | None = None
    shop_ids: list[int] | None = None

    @field_validator("email")
    @classmethod
    def normalize_optional_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()


class TenantRegistrationRequest(BaseModel):
    owner_name: str = Field(min_length=1, max_length=255)
    owner_email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=255)
    shop_name: str = Field(min_length=1, max_length=255)
    shop_slug: str = Field(min_length=3, max_length=120)

    @field_validator("owner_email")
    @classmethod
    def normalize_owner_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("shop_slug")
    @classmethod
    def validate_shop_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789-")
        if any(char not in allowed for char in slug):
            raise ValueError("shop_slug must contain only lowercase letters, numbers and hyphens")
        if slug.startswith("-") or slug.endswith("-"):
            raise ValueError("shop_slug cannot start or end with a hyphen")
        return slug


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime


class UserAdminRead(UserRead):
    shops: list[ShopRead] = Field(default_factory=list)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user: UserRead


class UserShopsResponse(BaseModel):
    shops: list[ShopRead]


class UserListResponse(BaseModel):
    users: list[UserAdminRead]
