from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ShopCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=3, max_length=120)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789-")
        if any(char not in allowed for char in slug):
            raise ValueError("slug must contain only lowercase letters, numbers and hyphens")
        if slug.startswith("-") or slug.endswith("-"):
            raise ValueError("slug cannot start or end with a hyphen")
        return slug


class ShopUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=3, max_length=120)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789-")
        if any(char not in allowed for char in slug):
            raise ValueError("slug must contain only lowercase letters, numbers and hyphens")
        if slug.startswith("-") or slug.endswith("-"):
            raise ValueError("slug cannot start or end with a hyphen")
        return slug


class ShopRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    created_at: datetime
