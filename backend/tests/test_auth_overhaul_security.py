from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app.core import auth_credentials
from app.core.config import Settings
from app.routers.auth.common import log_supabase_auth_failure, read_supabase_error
from app.services.auth_flow_service import purge_expired_auth_flows
from app.services.mfa_service import assert_aal2_auth_response


ROOT = Path(__file__).parents[1]


def _migration_035() -> str:
    return (
        (ROOT / "supabase" / "migrations" / "035_enforce_google_totp_onboarding.sql")
        .read_text(encoding="utf-8")
        .lower()
    )


def test_auth_migration_avoids_volatile_partial_index_predicates() -> None:
    source = _migration_035()

    assert "where expires_at > now()" not in source
    assert "where expires_at > current_timestamp" not in source
    assert "idx_flow_sessions_token" in source


@pytest.mark.parametrize(
    "table",
    [
        "account_invitations",
        "auth_flow_sessions",
        "auth_totp_factors",
        "auth_google_identities",
        "auth_recovery_codes",
    ],
)
def test_auth_migration_locks_private_tables_away_from_data_api(table: str) -> None:
    source = _migration_035()

    assert f"alter table public.{table} enable row level security" in source
    assert f"alter table public.{table} force row level security" in source
    assert f"revoke all on public.{table} from public, anon, authenticated" in source


def test_auth_migration_persists_only_encrypted_flow_credentials() -> None:
    source = _migration_035()

    assert "supabase_access_token_ciphertext text not null" in source
    assert "supabase_refresh_token_ciphertext text not null" in source
    assert "oauth_nonce_ciphertext text" in source
    assert "oauth_pkce_verifier_ciphertext text" in source
    assert "provider_refresh_token_ciphertext text not null" in source
    assert "supabase_access_token text" not in source
    assert "supabase_refresh_token text" not in source


def test_auth_source_never_places_upstream_tokens_in_flow_step_markers() -> None:
    session_source = (ROOT / "app" / "routers" / "auth" / "session.py").read_text(
        encoding="utf-8"
    )
    mfa_source = (ROOT / "app" / "routers" / "auth" / "mfa.py").read_text(
        encoding="utf-8"
    )

    assert 'f"rt:' not in session_source
    assert 'f"sat:' not in session_source
    assert "_read_pending_refresh_token" not in mfa_source


def test_every_password_login_requires_a_real_second_factor() -> None:
    source = (
        (ROOT / "app" / "routers" / "auth" / "session.py")
        .read_text(encoding="utf-8")
        .lower()
    )

    assert "owner bypasses totp" not in source
    assert "if is_owner_email(email):" not in source


def test_totp_qr_secret_is_not_sent_to_an_external_qr_service() -> None:
    matches: list[Path] = []
    for path in (ROOT.parent / "frontend" / "src").rglob("*"):
        if path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        if "api.qrserver.com" in path.read_text(encoding="utf-8"):
            matches.append(path)

    assert matches == []


def test_deployment_examples_separate_secrets_and_cookie_security() -> None:
    repository_root = ROOT.parent
    local = (ROOT / ".env.example").read_text(encoding="utf-8")
    staging = (ROOT / ".env.staging.example").read_text(encoding="utf-8")
    production = (ROOT / ".env.production.example").read_text(encoding="utf-8")
    frontend = (repository_root / "frontend" / ".env.example").read_text(
        encoding="utf-8"
    )
    compose = (repository_root / "docker-compose.yml").read_text(encoding="utf-8")

    required_backend_keys = {
        "APP_ENVIRONMENT",
        "AUTH_ENCRYPTION_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
        "INTERNAL_TOKEN_AUDIENCE",
        "INTERNAL_TOKEN_ISSUER",
        "ONBOARDING_SESSION_MINUTES",
        "LOGIN_MFA_SESSION_MINUTES",
        "AUTH_COOKIE_SECURE",
        "AVATAR_STORAGE_BUCKET",
    }
    for source in (local, staging, production):
        for key in required_backend_keys:
            assert f"{key}=" in source
        assert "DATABASE_URL=postgresql+asyncpg://tpro_backend:" in source
        assert "postgresql+asyncpg://app_user:" not in source
        assert "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY" not in source
        assert "NEXT_PUBLIC_GOOGLE_CLIENT_SECRET" not in source

    assert "AUTH_COOKIE_SECURE=false" in local
    assert "PRE_AUTH_SESSION_MINUTES" not in local + staging + production
    assert "AUTH_COOKIE_SECURE=true" in staging
    assert "AUTH_COOKIE_SECURE=true" in production
    assert "ALLOWED_HOSTS=" in staging and "127.0.0.1" in staging
    assert "ALLOWED_HOSTS=" in production and "127.0.0.1" in production
    assert "AUTH_COOKIE_SECURE=false" in frontend
    assert "AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-false}" in compose


def test_obsolete_auth_backup_and_custom_totp_engine_are_removed() -> None:
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()

    assert not (ROOT / "app" / "routers" / "auth.py.bak").exists()
    assert "pyotp" not in requirements
    assert "qrcode==" in requirements
    assert "requests==" in requirements


def test_container_runtime_and_access_logs_are_hardened() -> None:
    repository_root = ROOT.parent
    backend_dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    frontend_dockerfile = (repository_root / "frontend" / "Dockerfile").read_text(
        encoding="utf-8"
    )
    nginx = (repository_root / "nginx" / "tpro-classio.conf").read_text(
        encoding="utf-8"
    )

    assert "USER app" in backend_dockerfile
    assert '"--no-access-log"' in backend_dockerfile
    assert "RUN npm ci" in frontend_dockerfile
    assert "USER node" in frontend_dockerfile
    assert "COPY --chown=node:node" in frontend_dockerfile
    frontend_runner = frontend_dockerfile.split(" AS runner", maxsplit=1)[1]
    assert "/app/node_modules" not in frontend_runner
    assert "log_format tpro_redacted" in nginx
    assert '"$request_method $uri $server_protocol"' in nginx
    assert "access_log /var/log/nginx/access.log tpro_redacted;" in nginx
    assert "location ~ ^/api/proxy/auth/" in nginx
    generic_auth_location = nginx.split("location /api/proxy/auth/ {", maxsplit=1)[1]
    generic_auth_location = generic_auth_location.split("}", maxsplit=1)[0]
    assert "limit_req" not in generic_auth_location


def test_production_cors_never_inherits_localhost() -> None:
    production = Settings(
        _env_file=None,
        app_environment="production",
        database_url="postgresql+asyncpg://tpro_backend:strong@db.tpro.vn/postgres",
        secret_key="test-signing-key-with-more-than-thirty-two-chars",
        auth_encryption_key="test-encryption-key-with-more-than-thirty-two-chars",
        owner_admin_email="owner@tpro.vn",
        frontend_url="https://classio.tpro.vn",
        allowed_hosts="classio.tpro.vn,backend",
        supabase_url="https://project.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_service_role_key="test-service-role-key",
        google_client_id="test-client.apps.googleusercontent.com",
        google_client_secret="test-google-secret",
        google_redirect_uri="https://classio.tpro.vn/auth/google/callback",
        auth_cookie_secure=True,
    )
    local = Settings(
        _env_file=None,
        app_environment="local",
        database_url="postgresql+asyncpg://unused",
        secret_key="test-signing-key-with-more-than-thirty-two-chars",
        owner_admin_email="owner@example.com",
        frontend_url="http://127.0.0.1:3000",
    )

    assert production.cors_origin_list == ["https://classio.tpro.vn"]
    assert "http://localhost:3000" in local.cors_origin_list


def test_production_auth_config_fails_closed_on_placeholders_or_insecure_cookie() -> (
    None
):
    with pytest.raises(ValueError, match="missing or uses placeholders"):
        Settings(
            _env_file=None,
            app_environment="production",
            database_url="postgresql+asyncpg://tpro_backend:replace-me@db/postgres",
            secret_key="test-signing-key-with-more-than-thirty-two-chars",
            owner_admin_email="owner@tpro.vn",
        )

    with pytest.raises(ValueError, match="AUTH_COOKIE_SECURE"):
        Settings(
            _env_file=None,
            app_environment="production",
            database_url="postgresql+asyncpg://tpro_backend:strong@db.tpro.vn/postgres",
            secret_key="test-signing-key-with-more-than-thirty-two-chars",
            auth_encryption_key="test-encryption-key-with-more-than-thirty-two-chars",
            owner_admin_email="owner@tpro.vn",
            frontend_url="https://classio.tpro.vn",
            allowed_hosts="classio.tpro.vn,backend",
            supabase_url="https://project.supabase.co",
            supabase_anon_key="test-anon-key",
            supabase_service_role_key="test-service-role-key",
            google_client_id="test-client.apps.googleusercontent.com",
            google_client_secret="test-google-secret",
            google_redirect_uri="https://classio.tpro.vn/auth/google/callback",
            auth_cookie_secure=False,
        )


@pytest.mark.asyncio
async def test_expired_auth_flow_cleanup_is_destructive_and_committed() -> None:
    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(rowcount=4)

    removed = await purge_expired_auth_flows(db)

    statement = " ".join(str(db.execute.await_args.args[0]).lower().split())
    assert "delete from auth_flow_sessions" in statement
    assert "expires_at <= now() or consumed_at is not null" in statement
    assert removed == 4
    db.commit.assert_awaited_once()


def test_auth_logs_and_unknown_upstream_errors_never_reflect_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    leaked_value = "otp-or-oauth-secret-must-not-leak"
    response = httpx.Response(400, json={"message": leaked_value})

    with caplog.at_level("WARNING", logger="tpro_classio.auth"):
        log_supabase_auth_failure("test operation", response)

    assert leaked_value not in caplog.text
    assert leaked_value not in read_supabase_error(response, "Yêu cầu thất bại")
    assert read_supabase_error(response, "Yêu cầu thất bại") == "Yêu cầu thất bại"


def test_totp_and_avatar_concurrency_controls_remain_in_place() -> None:
    mfa_source = (ROOT / "app" / "services" / "mfa_service.py").read_text(
        encoding="utf-8"
    )
    avatar_source = (
        ROOT / "app" / "services" / "google_identity_service.py"
    ).read_text(encoding="utf-8")
    google_router = (ROOT / "app" / "routers" / "auth" / "google.py").read_text(
        encoding="utf-8"
    )

    assert 'f"totp-enrollment:{user_id}"' in mfa_source
    assert "pg_advisory_xact_lock" in mfa_source
    assert "/auth/v1/admin/users/" in mfa_source
    assert "reset_incomplete_totp_enrollment" in mfa_source
    assert "pg_try_advisory_xact_lock" in avatar_source
    assert '@router.post("/me/avatar/sync"' in google_router
    assert 'scope="avatar_sync"' in google_router
    assert "max_attempts=3" in google_router
    assert "window_seconds=15 * 60" in google_router


def test_auth_credential_encryption_is_purpose_separated(monkeypatch) -> None:
    monkeypatch.setattr(
        auth_credentials.settings,
        "auth_encryption_key",
        "unit-test-auth-encryption-key-that-is-independent-and-long",
    )
    ciphertext = auth_credentials.encrypt_credential(
        "sensitive-token", purpose="test-access"
    )

    assert ciphertext != "sensitive-token"
    assert (
        auth_credentials.decrypt_credential(ciphertext, purpose="test-access")
        == "sensitive-token"
    )
    with pytest.raises(HTTPException):
        auth_credentials.decrypt_credential(ciphertext, purpose="test-refresh")


def test_aal2_assertion_rejects_aal1_or_another_user() -> None:
    import jwt

    valid_user = "11111111-1111-1111-1111-111111111111"
    test_key = "test-only-hmac-key-longer-than-thirty-two-bytes"
    aal1 = jwt.encode({"sub": valid_user, "aal": "aal1"}, test_key, algorithm="HS256")
    another_user = jwt.encode(
        {"sub": "22222222-2222-2222-2222-222222222222", "aal": "aal2"},
        test_key,
        algorithm="HS256",
    )

    with pytest.raises(HTTPException):
        assert_aal2_auth_response(
            {"access_token": aal1, "refresh_token": "refresh"},
            expected_user_id=valid_user,
        )
    with pytest.raises(HTTPException):
        assert_aal2_auth_response(
            {"access_token": another_user, "refresh_token": "refresh"},
            expected_user_id=valid_user,
        )
