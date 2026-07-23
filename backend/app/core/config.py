from typing import Literal, Self
from urllib.parse import urlparse

from pydantic import EmailStr, Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_environment: Literal["local", "test", "staging", "production"] = "local"
    database_url: str
    secret_key: str = Field(min_length=32)
    algorithm: Literal["HS256"] = "HS256"
    internal_token_issuer: str = "tpro-classio-api"
    internal_token_audience: str = "tpro-classio-web"
    access_token_expire_minutes: int = 30
    session_absolute_expire_days: int = Field(default=30, ge=1, le=90)
    email_otp_expire_seconds: int = 600
    password_reset_token_expire_minutes: int = 10
    frontend_url: str = "http://localhost:3000"
    allowed_hosts: str = "localhost,127.0.0.1,backend,testserver"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    owner_admin_email: EmailStr
    # Google OAuth — cần thiết lập trong Google Cloud Console
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    # Dedicated credential-encryption key. Never reuse SECRET_KEY in production.
    auth_encryption_key: str = ""
    supabase_service_role_key: str = ""
    # Avatar storage
    avatar_storage_bucket: str = "avatars"
    avatar_max_bytes: int = 5 * 1024 * 1024  # 5 MB
    avatar_max_dimension: int = 512
    avatar_sync_hours: int = Field(default=12, ge=1, le=168)
    # Invitation settings
    invitation_expire_hours: int = 24
    onboarding_session_minutes: int = Field(default=15, ge=5, le=30)
    login_mfa_session_minutes: int = Field(default=5, ge=2, le=10)
    auth_cookie_secure: bool = True
    # TOTP issuer name
    totp_issuer: str = "TPRO Classio"

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        """Build an exact CORS allowlist without leaking local origins to prod."""
        origins = [self.frontend_url.rstrip("/")] if self.frontend_url else []
        if self.app_environment in {"local", "test"}:
            local_origin = "http://localhost:3000"
            if local_origin not in origins:
                origins.append(local_origin)
        return origins

    @model_validator(mode="after")
    def validate_production_auth_configuration(self) -> Self:
        """Fail closed before serving traffic with placeholder auth secrets."""
        if self.app_environment not in {"staging", "production"}:
            return self

        critical_values = {
            "DATABASE_URL": self.database_url,
            "SECRET_KEY": self.secret_key,
            "AUTH_ENCRYPTION_KEY": self.auth_encryption_key,
            "INTERNAL_TOKEN_ISSUER": self.internal_token_issuer,
            "INTERNAL_TOKEN_AUDIENCE": self.internal_token_audience,
            "FRONTEND_URL": self.frontend_url,
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_ANON_KEY": self.supabase_anon_key,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
            "GOOGLE_CLIENT_ID": self.google_client_id,
            "GOOGLE_CLIENT_SECRET": self.google_client_secret,
            "GOOGLE_REDIRECT_URI": self.google_redirect_uri,
            "OWNER_ADMIN_EMAIL": str(self.owner_admin_email),
        }
        invalid = [
            name
            for name, value in critical_values.items()
            if not value.strip()
            or any(
                marker in value.casefold()
                for marker in (
                    "replace-with",
                    "replace-me",
                    "your-project",
                    "example.com",
                )
            )
        ]
        if invalid:
            raise ValueError(
                "Production auth configuration is missing or uses placeholders: "
                + ", ".join(invalid)
            )
        if len(self.auth_encryption_key) < 32:
            raise ValueError("AUTH_ENCRYPTION_KEY must contain at least 32 characters")
        if not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be true outside local/test")

        frontend = urlparse(self.frontend_url)
        redirect = urlparse(self.google_redirect_uri)
        supabase = urlparse(self.supabase_url)
        if (
            frontend.scheme != "https"
            or not frontend.hostname
            or frontend.username is not None
            or frontend.password is not None
            or frontend.path not in {"", "/"}
            or frontend.params
            or frontend.query
            or frontend.fragment
        ):
            raise ValueError("FRONTEND_URL must be a credential-free HTTPS origin")
        if (
            supabase.scheme != "https"
            or not supabase.hostname
            or supabase.username is not None
            or supabase.password is not None
            or supabase.path not in {"", "/"}
            or supabase.params
            or supabase.query
            or supabase.fragment
        ):
            raise ValueError("SUPABASE_URL must be a credential-free HTTPS origin")
        if (
            redirect.scheme != frontend.scheme
            or redirect.netloc != frontend.netloc
            or redirect.path != "/auth/google/callback"
            or redirect.params
            or redirect.query
            or redirect.fragment
        ):
            raise ValueError(
                "GOOGLE_REDIRECT_URI must be the exact same-origin /auth/google/callback URL"
            )
        if (
            "*" in self.allowed_host_list
            or frontend.hostname not in self.allowed_host_list
        ):
            raise ValueError(
                "ALLOWED_HOSTS must explicitly contain the frontend hostname"
            )
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
