from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ShippingRuleBase(BaseModel):
    shop_id: int = Field(gt=0)
    zone_name: str = Field(min_length=1, max_length=120)
    shipping_rate_name: str | None = Field(default=None, max_length=255)
    shipping_rate_amount: float | None = None
    rule_type: str = Field(default="price", min_length=1, max_length=32)
    min_value: float | None = None
    max_value: float | None = None
    carrier_service_code: str = Field(min_length=1, max_length=64)
    carrier_service_label: str | None = Field(default=None, max_length=120)
    country_codes: list[str] | None = None
    province_codes: list[str] | None = None
    postal_code_patterns: list[str] | None = None
    is_active: bool = True
    priority: int = Field(default=100, ge=0, le=9999)
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("zone_name", "shipping_rate_name", "carrier_service_code", "carrier_service_label", "rule_type", "notes")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("country_codes", "province_codes", "postal_code_patterns")
    @classmethod
    def normalize_code_lists(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [item.strip().upper() for item in value if item and item.strip()]
        return normalized or None


class ShippingRuleCreate(ShippingRuleBase):
    pass


class ShippingRuleUpdate(BaseModel):
    zone_name: str | None = Field(default=None, min_length=1, max_length=120)
    shipping_rate_name: str | None = Field(default=None, max_length=255)
    shipping_rate_amount: float | None = None
    rule_type: str | None = Field(default=None, min_length=1, max_length=32)
    min_value: float | None = None
    max_value: float | None = None
    carrier_service_code: str | None = Field(default=None, max_length=64)
    carrier_service_label: str | None = Field(default=None, max_length=120)
    country_codes: list[str] | None = None
    province_codes: list[str] | None = None
    postal_code_patterns: list[str] | None = None
    is_active: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=9999)
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("zone_name", "shipping_rate_name", "carrier_service_code", "carrier_service_label", "rule_type", "notes")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("country_codes", "province_codes", "postal_code_patterns")
    @classmethod
    def normalize_code_lists(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [item.strip().upper() for item in value if item and item.strip()]
        return normalized or None


class ShippingRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    zone_name: str
    shipping_rate_name: str | None
    shipping_rate_amount: float | None
    rule_type: str
    min_value: float | None
    max_value: float | None
    carrier_service_code: str
    carrier_service_label: str | None
    country_codes: list[str] | None = Field(default=None, validation_alias="country_codes_json", serialization_alias="country_codes")
    province_codes: list[str] | None = Field(default=None, validation_alias="province_codes_json", serialization_alias="province_codes")
    postal_code_patterns: list[str] | None = Field(default=None, validation_alias="postal_code_patterns_json", serialization_alias="postal_code_patterns")
    is_active: bool
    priority: int
    notes: str | None
    created_at: datetime
    updated_at: datetime


class ShippingRuleResolutionRequest(BaseModel):
    order_id: int = Field(gt=0)
    weight_tier_code: str | None = Field(default=None, max_length=64)
    shipping_weight_declared: float | None = None
    shipping_type_code: str | None = Field(default=None, max_length=64)


class ShippingRuleResolutionRead(BaseModel):
    matched: bool
    zone_name: str | None = None
    resolution_mode: str = "automatic"
    carrier_service_code: str | None = None
    carrier_service_label: str | None = None
    shipping_rule_id: int | None = None
    shipping_rule_name: str | None = None
    match_reason: str | None = None
