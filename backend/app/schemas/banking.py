from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)


def _clean_text(value: str) -> str:
    return " ".join(value.strip().split())


class BankAccountCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    bank_code: str = Field(min_length=2, max_length=40)
    bank_name: str = Field(min_length=2, max_length=160)
    account_number: str = Field(min_length=4, max_length=30, pattern=r"^[0-9]{4,30}$")
    account_name: str = Field(min_length=2, max_length=160)
    qr_source_url: str | None = Field(default=None, max_length=2048)
    provider_account_id: str | None = Field(default=None, max_length=160)
    provider_bank_id: str | None = Field(default=None, max_length=160)
    va_number: str | None = Field(default=None, max_length=80)
    is_default: bool = False

    @field_validator("label", "bank_code", "bank_name", "account_name")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return _clean_text(value)


class BankAccountUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    bank_code: str | None = Field(default=None, min_length=2, max_length=40)
    bank_name: str | None = Field(default=None, min_length=2, max_length=160)
    account_number: str | None = Field(
        default=None, min_length=4, max_length=30, pattern=r"^[0-9]{4,30}$"
    )
    account_name: str | None = Field(default=None, min_length=2, max_length=160)
    qr_source_url: str | None = Field(default=None, max_length=2048)
    provider_account_id: str | None = Field(default=None, max_length=160)
    provider_bank_id: str | None = Field(default=None, max_length=160)
    va_number: str | None = Field(default=None, max_length=80)
    is_default: bool | None = None
    is_active: bool | None = None

    @field_validator("label", "bank_code", "bank_name", "account_name")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        return _clean_text(value) if value is not None else None


class BankAccountResponse(BaseModel):
    id: UUID
    label: str
    bank_code: str
    bank_name: str
    account_number: str
    account_name: str
    qr_source_url: str | None
    provider_account_id: str | None
    provider_bank_id: str | None
    va_number: str | None
    provider_status: str
    connection_type: Literal["external", "pay2s"] = "external"
    webhook_configured: bool = False
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class BankAccountListResponse(BaseModel):
    accounts: list[BankAccountResponse]


class Pay2SConnectionUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_key: SecretStr | None = Field(default=None, min_length=16, max_length=512)
    secret_key: SecretStr | None = Field(default=None, min_length=16, max_length=512)
    # Backward-compatible aliases accepted during the rolling deployment.
    api_key: SecretStr | None = Field(default=None, min_length=16, max_length=512)
    webhook_secret: SecretStr | None = Field(
        default=None, min_length=16, max_length=512
    )
    merchant_id: str | None = Field(default=None, max_length=160)
    partner_code: str | None = Field(default=None, max_length=160)
    collection_partner_code: str | None = Field(default=None, max_length=160)
    plan: str = Field(default="unconfirmed", min_length=1, max_length=80)

    @field_validator("merchant_id", "partner_code", "collection_partner_code", "plan")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _clean_text(value) if value is not None else None

    @model_validator(mode="after")
    def require_workspace_credentials(self) -> "Pay2SConnectionUpsert":
        if self.access_key is None and self.api_key is None:
            raise ValueError("Cần Access Key Pay2S")
        if self.secret_key is None:
            raise ValueError("Cần Secret Key Pay2S")
        return self


class Pay2SProviderStatusResponse(BaseModel):
    provider: Literal["pay2s"]
    status: Literal[
        "not_configured", "pending_verification", "connected", "error", "disabled"
    ]
    plan: str
    merchant_id: str | None
    partner_code: str | None
    collection_partner_code: str | None
    access_key_configured: bool
    webhook_configured: bool
    webhook_url: str | None
    connected_at: datetime | None
    last_error: str | None
    # Never return API keys or webhook secrets.


class Pay2SSupportedBankResponse(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    short_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=240)


class Pay2SSupportedBanksResponse(BaseModel):
    banks: list[Pay2SSupportedBankResponse]
    source: Literal["pay2s_official_snapshot"]
    verified_at: datetime


class Pay2SReadinessResponse(BaseModel):
    provider_verified: bool
    receiving_account_connected: bool
    collection_link_configured: bool
    transaction_webhook_configured: bool
    qr_creation_ready: bool
    automatic_recording_ready: bool
    blocker: (
        Literal[
            "provider_disabled",
            "qr_disabled",
            "provider_not_verified",
            "receiving_account_missing",
            "partner_code_missing",
            "ipn_url_missing",
            "webhook_ingress_disabled",
            "auto_post_disabled",
        ]
        | None
    )


class BankingOverviewResponse(BaseModel):
    accounts: list[BankAccountResponse]
    provider: Pay2SProviderStatusResponse
    readiness: Pay2SReadinessResponse


class Pay2SBankConnectRequest(BaseModel):
    bank_type: Literal["openapi", "personal"] = "openapi"
    bank_short_name: str = Field(min_length=2, max_length=20)
    account_number: str = Field(min_length=4, max_length=30, pattern=r"^[0-9]{4,30}$")
    account_name: str | None = Field(default=None, max_length=160)
    cccd: str | None = Field(default=None, max_length=32)
    merchant_id: str | None = Field(default=None, max_length=160)
    acc_mobile: str | None = Field(default=None, max_length=32)
    acc_email: str | None = Field(default=None, max_length=254)
    internet_banking_username: str | None = Field(default=None, max_length=160)
    internet_banking_password: SecretStr | None = Field(default=None, max_length=512)
    label: str | None = Field(default=None, max_length=120)

    @field_validator("bank_short_name")
    @classmethod
    def normalize_bank_code(cls, value: str) -> str:
        return _clean_text(value).upper()

    @model_validator(mode="after")
    def validate_connection_fields(self) -> "Pay2SBankConnectRequest":
        if self.bank_type == "personal":
            if not self.internet_banking_username or not self.internet_banking_password:
                raise ValueError(
                    "Kết nối Internet Banking cần tên đăng nhập và mật khẩu"
                )
            return self
        if not self.account_name or not self.acc_mobile:
            raise ValueError("Kết nối OpenAPI cần tên chủ tài khoản và số điện thoại")
        if self.bank_short_name == "BIDV" and not (
            self.cccd and self.merchant_id and self.acc_email
        ):
            raise ValueError("BIDV OpenAPI cần CCCD, Merchant ID và email")
        return self


class Pay2SBankConnectResponse(BaseModel):
    accepted: bool
    otp_required: bool
    message: str
    provider_bank_id: str | None = None
    va_number: str | None = None
    account: BankAccountResponse | None = None


class Pay2SBankOtpRequest(BaseModel):
    bank_type: Literal["openapi", "personal"] = "openapi"
    bank_short_name: str = Field(min_length=2, max_length=20)
    account_number: str = Field(min_length=4, max_length=30, pattern=r"^[0-9]{4,30}$")
    otp: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")
    merchant_id: str | None = Field(default=None, max_length=160)
    internet_banking_username: str | None = Field(default=None, max_length=160)
    internet_banking_password: SecretStr | None = Field(default=None, max_length=512)

    @field_validator("bank_short_name")
    @classmethod
    def normalize_otp_bank_code(cls, value: str) -> str:
        return _clean_text(value).upper()

    @model_validator(mode="after")
    def validate_personal_otp_credentials(self) -> "Pay2SBankOtpRequest":
        if self.bank_type == "personal" and (
            not self.internet_banking_username or not self.internet_banking_password
        ):
            raise ValueError(
                "Xác nhận Internet Banking cần lại tên đăng nhập và mật khẩu"
            )
        return self


class Pay2SWebhookResponse(BaseModel):
    id: str
    provider_webhook_id: str | None
    status: str
    webhook_url: str
    webhook_type: str
    bank_account_id: str
