from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ShopShippingSettings(BaseModel):
    sender_name: str | None = Field(default=None, max_length=255)
    sender_email: str | None = Field(default=None, max_length=320)
    sender_phone: str | None = Field(default=None, max_length=64)
    sender_country_code: str | None = Field(default=None, max_length=8)
    sender_postal_code: str | None = Field(default=None, max_length=32)
    sender_address_line1: str | None = Field(default=None, max_length=255)
    sender_address_line2: str | None = Field(default=None, max_length=255)
    sender_town: str | None = Field(default=None, max_length=120)
    sender_province: str | None = Field(default=None, max_length=120)
    default_shipping_type_code: str | None = Field(default=None, max_length=32)
    default_weight_tier_code: str | None = Field(default=None, max_length=32)
    label_reference_mode: str | None = Field(default="reference", max_length=32)
    recipient_email_notifications: bool = True
    default_package_strategy: str | None = Field(default="per_order", max_length=32)
    default_package_count: int | None = Field(default=1, ge=1, le=99)
    printer_name: str | None = Field(default=None, max_length=255)
    printer_label_format: str | None = Field(default="PDF", max_length=8)
    printer_auto_print: bool = False

    @field_validator(
        "sender_name",
        "sender_email",
        "sender_phone",
        "sender_postal_code",
        "sender_address_line1",
        "sender_address_line2",
        "sender_town",
        "sender_province",
        "default_shipping_type_code",
        "default_weight_tier_code",
        "label_reference_mode",
        "default_package_strategy",
        "printer_name",
        "printer_label_format",
    )
    @classmethod
    def strip_nullable_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("sender_country_code")
    @classmethod
    def normalize_country_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None


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
    name: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=3, max_length=120)
    shipping_settings: ShopShippingSettings | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        slug = value.strip().lower()
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789-")
        if any(char not in allowed for char in slug):
            raise ValueError("slug must contain only lowercase letters, numbers and hyphens")
        if slug.startswith("-") or slug.endswith("-"):
            raise ValueError("slug cannot start or end with a hyphen")
        return slug


class ShopRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    name: str
    slug: str
    shipping_settings: ShopShippingSettings | None = Field(
        default=None,
        validation_alias="shipping_settings_json",
        serialization_alias="shipping_settings",
    )
    created_at: datetime
