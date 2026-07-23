from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.routers.auth import mfa
from app.schemas.auth import TokenResponse, TotpVerifyRequest


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "headers": [
                (b"x-tpro-device-id", b"unit-test-device-0001"),
                (b"user-agent", b"pytest"),
            ],
        }
    )


@pytest.mark.asyncio
async def test_totp_enrollment_is_rate_limited_before_provider_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid4())
    flow = SimpleNamespace(
        user_id=user_id,
        email="member@example.com",
        completed_steps=["google_linked"],
    )
    db = AsyncMock()
    google_result = Mock()
    google_result.scalar_one_or_none.return_value = object()
    db.execute.return_value = google_result
    enforce = AsyncMock()
    enroll = AsyncMock(
        return_value={
            "factor_id": "factor-id",
            "totp_uri": "otpauth://totp/example",
            "secret": "SECRET",
            "qr_code_data_url": "data:image/png;base64,AA==",
        }
    )
    monkeypatch.setattr(mfa, "validate_flow_session", AsyncMock(return_value=flow))
    monkeypatch.setattr(mfa, "enforce_rate_limit", enforce)
    monkeypatch.setattr(mfa, "read_upstream_credentials", lambda flow: ("sat", "srt"))
    monkeypatch.setattr(mfa, "enroll_totp", enroll)

    await mfa.onboarding_totp_enroll(_request(), db)

    enforce.assert_awaited_once_with(
        db,
        scope="totp_enroll",
        subject=user_id,
        max_attempts=3,
        window_seconds=15 * 60,
    )
    enroll.assert_awaited_once()


def _patch_totp_login_success(
    monkeypatch: pytest.MonkeyPatch,
    *,
    verify: AsyncMock,
) -> tuple[AsyncMock, AsyncMock, str]:
    user_id = str(uuid4())
    flow = SimpleNamespace(
        id=str(uuid4()),
        user_id=user_id,
        email="member@example.com",
    )
    profile = SimpleNamespace(id=user_id, role="viewer")
    db = AsyncMock()
    profile_result = Mock()
    profile_result.scalar_one_or_none.return_value = profile
    db.execute.return_value = profile_result
    clear = AsyncMock()
    monkeypatch.setattr(mfa, "validate_flow_session", AsyncMock(return_value=flow))
    monkeypatch.setattr(mfa, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(mfa, "clear_rate_limit", clear)
    monkeypatch.setattr(mfa, "read_upstream_credentials", lambda flow: ("sat", "srt"))
    monkeypatch.setattr(mfa, "verify_totp_code", verify)
    monkeypatch.setattr(
        mfa,
        "upsert_device_session",
        AsyncMock(
            return_value=SimpleNamespace(device_type="desktop", session_nonce="n")
        ),
    )
    monkeypatch.setattr(mfa, "consume_flow_session", AsyncMock())
    monkeypatch.setattr(mfa, "delete_flow_session", AsyncMock())
    monkeypatch.setattr(
        mfa,
        "issue_internal_token",
        AsyncMock(
            return_value=TokenResponse(
                access_token="internal-access",
                refresh_token="aal2-refresh",
                role="viewer",
            )
        ),
    )
    return db, clear, user_id


@pytest.mark.asyncio
async def test_successful_totp_login_clears_only_its_failure_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factor = SimpleNamespace(provider_factor_id="factor-id")
    verify = AsyncMock(
        return_value=(
            factor,
            {"access_token": "aal2-access", "refresh_token": "aal2-refresh"},
        )
    )
    db, clear, user_id = _patch_totp_login_success(monkeypatch, verify=verify)

    result = await mfa.login_totp_verify(
        TotpVerifyRequest(code="123456"), _request(), Response(), db
    )

    assert result.access_token == "internal-access"
    clear.assert_awaited_once_with(
        db,
        scope="totp_login",
        subject=user_id,
        commit=False,
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_totp_login_keeps_failure_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    verify = AsyncMock(
        side_effect=HTTPException(status_code=400, detail="Mã không hợp lệ")
    )
    db, clear, _ = _patch_totp_login_success(monkeypatch, verify=verify)

    with pytest.raises(HTTPException):
        await mfa.login_totp_verify(
            TotpVerifyRequest(code="123456"), _request(), Response(), db
        )

    clear.assert_not_awaited()
    db.commit.assert_not_awaited()
