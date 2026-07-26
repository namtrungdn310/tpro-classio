import hmac
from pathlib import Path
from typing import Literal, Self
from urllib.parse import parse_qsl, unquote, urlparse

from pydantic import EmailStr, Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Required on purpose: an omitted/misspelled deployment environment must
    # never silently fall back to the less restrictive local policy.
    app_environment: Literal["local", "test", "staging", "production"]
    database_url: str
    database_ssl_mode: Literal["disable", "require", "verify-full"] = "require"
    database_ssl_root_cert: str = ""
    secret_key: str = Field(min_length=32)
    algorithm: Literal["HS256"] = "HS256"
    internal_token_issuer: str = "tpro-classio-api"
    internal_token_audience: str = "tpro-classio-web"
    access_token_expire_minutes: int = Field(default=30, ge=5, le=60)
    session_absolute_expire_days: int = Field(default=30, ge=1, le=90)
    email_otp_expire_seconds: int = Field(default=600, ge=60, le=3600)
    password_reset_token_expire_minutes: int = Field(default=10, ge=5, le=30)
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
    # The private bucket is part of the database security contract (migration
    # 039).  Do not make it operator-configurable: an accidental bucket-name
    # override must never route avatar reads to an unprotected bucket.
    avatar_storage_bucket: Literal["avatars"] = "avatars"
    avatar_max_bytes: int = Field(
        default=5 * 1024 * 1024,
        ge=64 * 1024,
        le=10 * 1024 * 1024,
    )
    avatar_max_dimension: int = Field(default=512, ge=64, le=2048)
    avatar_sync_hours: int = Field(default=12, ge=1, le=168)
    # Invitation settings
    invitation_expire_hours: int = Field(default=24, ge=1, le=168)
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

    @property
    def api_docs_enabled(self) -> bool:
        """Expose API discovery only in explicitly non-public environments."""
        return self.app_environment in {"local", "test"}

    @property
    def database_ssl_required(self) -> bool:
        """Require TLS for every deployed database and remote Supabase host."""
        return self.database_ssl_mode != "disable"

    @property
    def database_ssl_root_cert_path(self) -> str | None:
        """Resolve a relative CA path from the backend env-file directory."""
        configured = self.database_ssl_root_cert.strip()
        if not configured:
            return None
        path = Path(configured)
        if not path.is_absolute():
            path = BACKEND_ENV_FILE.parent / path
        return str(path.resolve())

    @model_validator(mode="after")
    def validate_production_auth_configuration(self) -> Self:
        """Fail closed before serving traffic with placeholder auth secrets."""
        database = urlparse(self.database_url)
        remote_database_host = (database.hostname or "").casefold()
        if (
            self.app_environment == "local"
            and remote_database_host
            and remote_database_host
            not in {"localhost", "127.0.0.1", "::1", "backend", "postgres", "db"}
            and self.database_ssl_mode != "verify-full"
        ):
            raise ValueError(
                "Remote development databases require DATABASE_SSL_MODE=verify-full"
            )

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
        if self.auth_encryption_key == self.secret_key:
            raise ValueError("AUTH_ENCRYPTION_KEY must be independent from SECRET_KEY")
        if hmac_compare(self.supabase_anon_key, self.supabase_service_role_key):
            raise ValueError(
                "SUPABASE_SERVICE_ROLE_KEY must differ from SUPABASE_ANON_KEY"
            )
        if not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be true outside local/test")
        if self.database_ssl_mode != "verify-full":
            raise ValueError("DATABASE_SSL_MODE must be verify-full outside local/test")
        if not self.database_ssl_root_cert.strip():
            raise ValueError(
                "DATABASE_SSL_ROOT_CERT is required when DATABASE_SSL_MODE=verify-full"
            )

        frontend = urlparse(self.frontend_url)
        redirect = urlparse(self.google_redirect_uri)
        supabase = urlparse(self.supabase_url)
        try:
            _ = database.port
        except ValueError as exc:
            raise ValueError("DATABASE_URL contains an invalid port") from exc
        database_username = unquote(database.username or "").casefold()
        if (
            database.scheme != "postgresql+asyncpg"
            or not database.hostname
            or not database_username
            or not database.password
            or not database.path.strip("/")
        ):
            raise ValueError(
                "DATABASE_URL must be a complete postgresql+asyncpg runtime URL"
            )
        database_query_keys = {
            key.casefold()
            for key, _ in parse_qsl(database.query, keep_blank_values=True)
        }
        if database_query_keys & {"ssl", "sslmode", "sslrootcert"}:
            raise ValueError(
                "Configure database TLS with DATABASE_SSL_MODE and "
                "DATABASE_SSL_ROOT_CERT, not DATABASE_URL query parameters"
            )
        if database_username.split(".", 1)[0] in {
            "postgres",
            "supabase_admin",
        }:
            raise ValueError(
                "DATABASE_URL must use a dedicated non-superuser runtime role"
            )
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
            any("*" in host for host in self.allowed_host_list)
            or frontend.hostname not in self.allowed_host_list
        ):
            raise ValueError(
                "ALLOWED_HOSTS must contain exact hostnames without wildcards "
                "and explicitly include the frontend hostname"
            )
        return self

    model_config = SettingsConfigDict(
        # Resolve relative to the backend package, not the caller's current
        # directory.  Running tests/tools from the repository root must not
        # accidentally parse root Compose variables as backend settings.
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        extra="forbid",
    )


def hmac_compare(left: str, right: str) -> bool:
    """Constant-time equality for configured credentials."""
    return bool(left and right) and hmac.compare_digest(left, right)


settings = Settings()
