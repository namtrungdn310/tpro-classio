from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
OTP_LENGTH = 6
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 20
USERNAME_PATTERN = r"^[A-Za-z0-9]+$"


def validate_password_strength(value: str) -> str:
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError("Mật khẩu phải có ít nhất 8 ký tự")
    if len(value) > PASSWORD_MAX_LENGTH:
        raise ValueError("Mật khẩu không được vượt quá 128 ký tự")
    if not any(character.isupper() for character in value):
        raise ValueError("Mật khẩu phải có ít nhất 1 chữ in hoa")
    if not any(character.isdigit() for character in value):
        raise ValueError("Mật khẩu phải có ít nhất 1 chữ số")
    if not any(
        not character.isalnum() and not character.isspace() for character in value
    ):
        raise ValueError("Mật khẩu phải có ít nhất 1 ký tự đặc biệt")
    return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class VerifyCurrentPasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(
        min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH
    )
    username: str | None = Field(
        default=None,
        min_length=USERNAME_MIN_LENGTH,
        max_length=USERNAME_MAX_LENGTH,
        pattern=USERNAME_PATTERN,
    )
    invitation_token: str = Field(
        min_length=1, description="Opaque invitation token from invite link"
    )

    @field_validator("password")
    @classmethod
    def password_has_required_strength(cls, value: str) -> str:
        return validate_password_strength(value)


class AuthEmailRequest(BaseModel):
    email: EmailStr


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=OTP_LENGTH, max_length=OTP_LENGTH, pattern=r"^\d{6}$")


class CompletePasswordResetRequest(BaseModel):
    reset_token: str = Field(min_length=1)
    new_password: str = Field(
        min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH
    )

    @field_validator("new_password")
    @classmethod
    def new_password_has_required_strength(cls, value: str) -> str:
        return validate_password_strength(value)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class LogoutRequest(BaseModel):
    # Injected from the HttpOnly cookie by the trusted Next BFF. Optional so
    # the local application session can still be revoked after cookie expiry.
    refresh_token: str | None = Field(default=None, min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    is_owner: bool = False


class MfaRequiredResponse(BaseModel):
    message: str
    requires_mfa: bool = True
    next_step: Literal["login_totp", "onboarding_google", "onboarding_totp"]


class GoogleAuthorizationResponse(BaseModel):
    authorization_url: str


class MessageResponse(BaseModel):
    message: str


class OtpMessageResponse(MessageResponse):
    otp_expires_in_seconds: int = Field(gt=0)


class PasswordResetOtpResponse(BaseModel):
    reset_token: str
    reset_token_expires_in_seconds: int = Field(gt=0)


class UserMe(BaseModel):
    id: str
    email: str
    role: str
    username: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None
    is_owner: bool = False


class UserAccount(BaseModel):
    id: str
    email: str
    role: str
    username: str | None = None
    full_name: str | None = None
    is_owner: bool = False
    account_status: Literal["pending", "active", "disabled"]
    created_at: str | None = None


class UpdateUserRoleRequest(BaseModel):
    role: Literal["admin", "viewer"]


class UpdateUserStatusRequest(BaseModel):
    status: Literal["active", "disabled"]


class UpdateUsernameRequest(BaseModel):
    username: str = Field(
        min_length=USERNAME_MIN_LENGTH,
        max_length=USERNAME_MAX_LENGTH,
        pattern=USERNAME_PATTERN,
    )


class InvitationCreate(BaseModel):
    email: EmailStr


class InvitationSummary(BaseModel):
    id: str
    email: str
    role: str
    expires_at: str
    consumed: bool
    revoked: bool
    created_at: str


class InvitationResponse(InvitationSummary):
    invite_url: str


class TotpEnrollResponse(BaseModel):
    factor_id: str
    totp_uri: str
    secret: str
    qr_code_data_url: str


class TotpVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class RecoveryCodeLoginRequest(BaseModel):
    recovery_code: str = Field(
        min_length=19,
        max_length=19,
        pattern=r"^[A-Za-z2-7]{4}(?:-[A-Za-z2-7]{4}){3}$",
    )
