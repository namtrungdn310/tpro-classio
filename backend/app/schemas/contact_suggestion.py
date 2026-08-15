from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phone import is_valid_vietnam_mobile_phone, normalize_vietnam_phone

ContactSuggestionOwner = Literal["student", "parent", "staff"]


class ContactSuggestionLookup(BaseModel):
    """Exact contact-pair lookup without putting personal data in a URL."""

    model_config = ConfigDict(str_strip_whitespace=True)

    owner: ContactSuggestionOwner
    phone: str | None = Field(default=None, min_length=1, max_length=32)
    zalo_name: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = normalize_vietnam_phone(value)
        if normalized is None or not is_valid_vietnam_mobile_phone(normalized):
            raise ValueError("Số điện thoại không hợp lệ")
        return normalized

    @model_validator(mode="after")
    def require_exactly_one_lookup_value(self) -> "ContactSuggestionLookup":
        if (self.phone is None) == (self.zalo_name is None):
            raise ValueError("Chỉ cung cấp một giá trị dùng để tra cứu")
        return self


class ContactSuggestionResponse(BaseModel):
    phone: str
    zalo_name: str
