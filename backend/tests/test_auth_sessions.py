from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import jwt
from fastapi import HTTPException, Response

from app.core.dependencies import get_current_user
from app.core.device_sessions import DeviceSessionContext, hash_device_value
from app.models.user_device_session import UserDeviceSession
from app.routers.auth import common, session
from app.schemas.auth import (
    CompletePasswordResetRequest,
    LoginRequest,
    LogoutRequest,
    MfaRequiredResponse,
    RefreshRequest,
    TokenResponse,
    VerifyCurrentPasswordRequest,
)


class OneResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def one_or_none(self) -> object:
        return self._value

    def scalar_one_or_none(self) -> object:
        return self._value


def _supabase_access_token(
    user_id: str,
    *,
    aal: str = "aal2",
    session_id: str = "upstream-session-id",
) -> str:
    return jwt.encode(
        {"sub": user_id, "aal": aal, "session_id": session_id},
        "unit-test-supabase-token-key-long-enough",
        algorithm="HS256",
    )


def _profile(
    user_id: str,
    *,
    account_status: str = "active",
    onboarded: bool = True,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        email="member@example.com",
        role="viewer",
        username="Member",
        full_name="Member",
        avatar_url=None,
        account_status=account_status,
        onboarding_completed_at=(datetime.now(timezone.utc) if onboarded else None),
    )


@pytest.mark.asyncio
async def test_current_user_uses_current_database_role_and_requires_aal2() -> None:
    user_id = str(uuid4())
    device_id = "device_identifier_123456"
    verified_at = datetime.now(timezone.utc)
    stored_session = SimpleNamespace(
        session_nonce="nonce",
        device_id_hash=hash_device_value(device_id),
        created_at=datetime.now(timezone.utc),
        aal="aal2",
        mfa_verified_at=verified_at,
    )
    db = AsyncMock()
    db.execute.return_value = OneResult(
        (stored_session, "viewer", "active", "Viewer", "Viewer", None)
    )
    token_payload = {
        "sub": user_id,
        "email": "viewer@example.com",
        "role": "admin",
        "aal": "aal2",
        "device_type": "desktop",
        "session_nonce": "nonce",
    }

    with (
        patch("app.core.dependencies.verify_token", return_value=token_payload),
        patch("app.core.dependencies.read_device_id", return_value=device_id),
    ):
        current_user = await get_current_user(
            request=SimpleNamespace(),
            db=db,
            token="signed-token",
        )

    assert current_user["role"] == "viewer"
    assert current_user["aal"] == "aal2"
    assert current_user["mfa_verified_at"] == verified_at


@pytest.mark.asyncio
@pytest.mark.parametrize("account_status", ["pending", "disabled"])
async def test_current_user_rejects_non_active_account(account_status: str) -> None:
    user_id = str(uuid4())
    device_id = "device_identifier_123456"
    stored_session = SimpleNamespace(
        session_nonce="nonce",
        device_id_hash=hash_device_value(device_id),
        created_at=datetime.now(timezone.utc),
        aal="aal2",
        mfa_verified_at=datetime.now(timezone.utc),
    )
    db = AsyncMock()
    db.execute.return_value = OneResult(
        (stored_session, "viewer", account_status, None, None, None)
    )
    token_payload = {
        "sub": user_id,
        "email": "viewer@example.com",
        "role": "viewer",
        "aal": "aal2",
        "device_type": "desktop",
        "session_nonce": "nonce",
    }

    with (
        patch("app.core.dependencies.verify_token", return_value=token_payload),
        patch("app.core.dependencies.read_device_id", return_value=device_id),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(
                request=SimpleNamespace(),
                db=db,
                token="signed-token",
            )

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_device_session_login_resets_absolute_lifetime_but_refresh_does_not() -> (
    None
):
    db = AsyncMock()
    common_args = {
        "db": db,
        "user_id": str(uuid4()),
        "device_type": "desktop",
        "device_id": "device_identifier_123456",
        "refresh_token": "refresh-token-value",
        "supabase_access_token": _supabase_access_token(str(uuid4())),
        "user_agent": "test-agent",
        "aal": "aal2",
    }

    await common.upsert_device_session(**common_args, rotate_nonce=True)
    login_statement = str(db.execute.await_args.args[0])
    assert "created_at =" in login_statement

    await common.upsert_device_session(
        **common_args,
        rotate_nonce=False,
        existing_nonce="existing-nonce",
    )
    refresh_statement = str(db.execute.await_args.args[0])
    assert "created_at =" not in refresh_statement


@pytest.mark.asyncio
async def test_every_role_without_completed_factor_enters_onboarding_not_app_session() -> (
    None
):
    user_id = str(uuid4())
    auth_data = {
        "access_token": _supabase_access_token(user_id, aal="aal1"),
        "refresh_token": "supabase-refresh-token",
        "user": {"id": user_id, "email": "owner@example.com"},
    }
    profile = _profile(user_id, onboarded=False)
    db = AsyncMock()
    db.execute.side_effect = [OneResult(None), OneResult(None)]
    create_flow = AsyncMock(return_value=str(uuid4()))
    issue_token = AsyncMock()
    upsert = AsyncMock()

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch("app.routers.auth.session.enforce_rate_limit", new=AsyncMock()),
        patch("app.routers.auth.session.clear_rate_limit", new=AsyncMock()),
        patch(
            "app.routers.auth.session.supabase_post",
            new=AsyncMock(
                return_value=SimpleNamespace(
                    status_code=200,
                    json=lambda: auth_data,
                )
            ),
        ),
        patch("app.routers.auth.session.classify_device_type", return_value="desktop"),
        patch(
            "app.routers.auth.session.read_device_id",
            return_value="device_identifier_123456",
        ),
        patch(
            "app.routers.auth.session.get_or_create_profile",
            new=AsyncMock(return_value=profile),
        ),
        patch("app.routers.auth.session.create_flow_session", new=create_flow),
        patch("app.routers.auth.session.issue_internal_token", new=issue_token),
        patch("app.routers.auth.session.upsert_device_session", new=upsert),
    ):
        result = await session.login(
            LoginRequest(email="owner@example.com", password="StrongPassword1!"),
            SimpleNamespace(headers={}),
            Response(),
            db,
        )

    assert isinstance(result, MfaRequiredResponse)
    assert result.next_step == "onboarding_google"
    create_flow.assert_awaited_once()
    issue_token.assert_not_awaited()
    upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_fully_onboarded_password_login_still_requires_totp() -> None:
    user_id = str(uuid4())
    auth_data = {
        "access_token": _supabase_access_token(user_id, aal="aal1"),
        "refresh_token": "supabase-refresh-token",
        "user": {"id": user_id, "email": "member@example.com"},
    }
    profile = _profile(user_id)
    factor = SimpleNamespace(verified_at=datetime.now(timezone.utc))
    identity = SimpleNamespace(user_id=user_id)
    db = AsyncMock()
    db.execute.side_effect = [OneResult(factor), OneResult(identity)]

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch("app.routers.auth.session.enforce_rate_limit", new=AsyncMock()),
        patch("app.routers.auth.session.clear_rate_limit", new=AsyncMock()),
        patch(
            "app.routers.auth.session.supabase_post",
            new=AsyncMock(
                return_value=SimpleNamespace(
                    status_code=200,
                    json=lambda: auth_data,
                )
            ),
        ),
        patch(
            "app.routers.auth.session.get_or_create_profile",
            new=AsyncMock(return_value=profile),
        ),
        patch(
            "app.routers.auth.session.create_flow_session",
            new=AsyncMock(return_value=str(uuid4())),
        ),
    ):
        result = await session.login(
            LoginRequest(email="member@example.com", password="StrongPassword1!"),
            SimpleNamespace(headers={}),
            Response(),
            db,
        )

    assert isinstance(result, MfaRequiredResponse)
    assert result.next_step == "login_totp"


@pytest.mark.asyncio
async def test_refresh_never_upgrades_an_upstream_aal1_session() -> None:
    user_id = str(uuid4())
    auth_data = {
        "access_token": _supabase_access_token(user_id, aal="aal1"),
        "refresh_token": "rotated-refresh-token",
        "user": {"id": user_id, "email": "member@example.com"},
    }
    aal1_session = SimpleNamespace(
        created_at=datetime.now(timezone.utc),
        aal="aal1",
        mfa_verified_at=None,
        mfa_factor_id=None,
    )
    db = AsyncMock()
    db.execute.return_value = OneResult(aal1_session)

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch(
            "app.routers.auth.session.supabase_post",
            new=AsyncMock(
                return_value=SimpleNamespace(
                    status_code=200,
                    json=lambda: auth_data,
                )
            ),
        ),
        patch(
            "app.routers.auth.session.classify_device_type",
            return_value="desktop",
        ),
        patch(
            "app.routers.auth.session.read_device_id",
            return_value="device_identifier_123456",
        ),
        patch(
            "app.routers.auth.session.get_or_create_profile",
            new=AsyncMock(return_value=_profile(user_id)),
        ),
        patch(
            "app.routers.auth.session.revoke_temporary_supabase_session",
            new=AsyncMock(return_value=True),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await session.refresh(
                RefreshRequest(refresh_token="parent-refresh-token"),
                SimpleNamespace(headers={}),
                db,
            )

    assert exc_info.value.status_code in {401, 403}


@pytest.mark.asyncio
async def test_refresh_preserves_verified_local_aal2_and_absolute_lifetime() -> None:
    user_id = str(uuid4())
    session_id = "upstream-session-id"
    access_token = _supabase_access_token(
        user_id,
        aal="aal2",
        session_id=session_id,
    )
    auth_data = {
        "access_token": access_token,
        "refresh_token": "active-refresh-token",
        "user": {"id": user_id, "email": "member@example.com"},
    }
    verified_at = datetime.now(timezone.utc)
    active_session = UserDeviceSession(
        user_id=user_id,
        device_type="desktop",
        device_id_hash=hash_device_value("device_identifier_123456"),
        refresh_token_hash=hash_device_value("active-refresh-token"),
        session_nonce="existing-nonce",
        supabase_session_id=session_id,
        created_at=datetime.now(timezone.utc) - timedelta(days=1),
        aal="aal2",
        mfa_factor_id="factor-id",
        mfa_verified_at=verified_at,
    )
    db = AsyncMock()
    db.execute.return_value = OneResult(active_session)
    expected = TokenResponse(
        access_token="internal-access",
        refresh_token="active-refresh-token",
        role="viewer",
    )
    upsert = AsyncMock(
        return_value=DeviceSessionContext(
            device_type="desktop", session_nonce="existing-nonce"
        )
    )

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch(
            "app.routers.auth.session.supabase_post",
            new=AsyncMock(
                return_value=SimpleNamespace(
                    status_code=200,
                    json=lambda: auth_data,
                )
            ),
        ),
        patch(
            "app.routers.auth.session.get_or_create_profile",
            new=AsyncMock(return_value=_profile(user_id)),
        ),
        patch("app.routers.auth.session.upsert_device_session", new=upsert),
        patch(
            "app.routers.auth.session.issue_internal_token",
            new=AsyncMock(return_value=expected),
        ),
        patch(
            "app.routers.auth.session.classify_device_type",
            return_value="desktop",
        ),
        patch(
            "app.routers.auth.session.read_device_id",
            return_value="device_identifier_123456",
        ),
    ):
        result = await session.refresh(
            RefreshRequest(refresh_token="parent-refresh-token"),
            SimpleNamespace(headers={}),
            db,
        )

    assert result == expected
    assert upsert.await_args.kwargs["rotate_nonce"] is False
    assert upsert.await_args.kwargs["aal"] == "aal2"
    assert upsert.await_args.kwargs["mfa_verified_at"] == verified_at


@pytest.mark.asyncio
async def test_current_password_verification_does_not_rotate_device_session() -> None:
    user_id = str(uuid4())
    auth_data = {
        "access_token": _supabase_access_token(user_id, aal="aal1"),
        "refresh_token": "supabase-refresh-token",
        "user": {"id": user_id, "email": "active@example.com"},
    }
    upstream = AsyncMock(
        return_value=SimpleNamespace(status_code=200, json=lambda: auth_data)
    )
    upsert = AsyncMock()

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch("app.routers.auth.session.enforce_rate_limit", new=AsyncMock()),
        patch("app.routers.auth.session.clear_rate_limit", new=AsyncMock()),
        patch("app.routers.auth.session.supabase_post", new=upstream),
        patch(
            "app.routers.auth.session.revoke_temporary_supabase_session",
            new=AsyncMock(return_value=True),
        ) as revoke,
        patch("app.routers.auth.session.upsert_device_session", new=upsert),
    ):
        response = await session.verify_current_password(
            VerifyCurrentPasswordRequest(password="StrongPassword1!"),
            AsyncMock(),
            {
                "id": user_id,
                "email": "active@example.com",
                "role": "viewer",
                "is_owner": False,
            },
        )

    assert "xác minh" in response.message.lower()
    upstream.assert_awaited_once()
    revoke.assert_awaited_once()
    upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_wrong_current_password_has_a_specific_error() -> None:
    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch("app.routers.auth.session.enforce_rate_limit", new=AsyncMock()),
        patch(
            "app.routers.auth.session.supabase_post",
            new=AsyncMock(
                return_value=SimpleNamespace(status_code=400, json=lambda: {})
            ),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await session.verify_current_password(
                VerifyCurrentPasswordRequest(password="WrongPassword1!"),
                AsyncMock(),
                {
                    "id": str(uuid4()),
                    "email": "active@example.com",
                    "role": "viewer",
                    "is_owner": False,
                },
            )

    assert exc_info.value.status_code == 400
    assert "mật khẩu hiện tại" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_password_reset_revokes_sessions_without_auto_login() -> None:
    user_id = str(uuid4())
    db = AsyncMock()
    issue_token = AsyncMock()
    upsert = AsyncMock()
    revoke_upstream = AsyncMock(return_value=True)

    with (
        patch("app.routers.auth.session.ensure_supabase_auth_configured"),
        patch(
            "app.routers.auth.session.claim_password_reset_handle",
            new=AsyncMock(
                return_value=(
                    user_id,
                    "user@example.com",
                    "supabase-access-token",
                )
            ),
        ),
        patch(
            "app.routers.auth.session.supabase_put",
            new=AsyncMock(return_value=SimpleNamespace(status_code=200)),
        ),
        patch("app.routers.auth.session.issue_internal_token", new=issue_token),
        patch("app.routers.auth.session.upsert_device_session", new=upsert),
        patch(
            "app.routers.auth.session.revoke_supabase_access_token",
            new=revoke_upstream,
        ),
    ):
        response = await session.complete_password_reset(
            CompletePasswordResetRequest(
                reset_token="opaque-reset-token",
                new_password="StrongPassword1!",
            ),
            db,
        )

    assert "đăng nhập lại" in response.message.lower()
    assert "DELETE FROM user_device_sessions" in str(db.execute.await_args.args[0])
    issue_token.assert_not_awaited()
    upsert.assert_not_awaited()
    revoke_upstream.assert_awaited_once_with(
        "supabase-access-token",
        scope="global",
        operation="password reset global logout",
    )


@pytest.mark.asyncio
async def test_logout_always_deletes_local_session_and_revokes_upstream_cookie() -> (
    None
):
    user_id = str(uuid4())
    db = AsyncMock()
    revoke_upstream = AsyncMock(return_value=False)

    with patch(
        "app.routers.auth.session.revoke_supabase_session_by_refresh_token",
        new=revoke_upstream,
    ):
        response = await session.logout(
            LogoutRequest(refresh_token="server-injected-refresh-token"),
            db,
            {
                "id": user_id,
                "device_type": "desktop",
                "session_nonce": "current-session-nonce",
            },
        )

    statement = str(db.execute.await_args.args[0]).lower()
    assert "delete from user_device_sessions" in statement
    db.commit.assert_awaited_once()
    revoke_upstream.assert_awaited_once_with(
        "server-injected-refresh-token",
        operation="user logout",
    )
    assert response["message"] == "Đã đăng xuất"
