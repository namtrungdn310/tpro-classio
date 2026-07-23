from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.routers.auth import common, registration
from app.schemas.auth import MessageResponse, RegisterRequest, VerifyOtpRequest


def _register_payload(email: str = "member@example.com") -> RegisterRequest:
    return RegisterRequest(
        email=email,
        password="ValidPassword1!",
        username="MemberUser",
        invitation_token="opaque-invitation-token",
    )


def _patch_registration_basics(
    monkeypatch: pytest.MonkeyPatch,
    *,
    invitation: object | None = None,
) -> None:
    monkeypatch.setattr(registration, "ensure_supabase_auth_configured", lambda: None)
    monkeypatch.setattr(registration, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(registration, "lock_registration_email", AsyncMock())
    monkeypatch.setattr(
        registration,
        "validate_invitation",
        AsyncMock(return_value=invitation or SimpleNamespace(id=str(uuid4()))),
    )


@pytest.mark.asyncio
async def test_register_rejects_an_existing_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    signup = AsyncMock()
    _patch_registration_basics(monkeypatch)
    monkeypatch.setattr(
        registration,
        "get_active_auth_user_id_by_email",
        AsyncMock(return_value="existing-user-id"),
    )
    monkeypatch.setattr(registration, "supabase_post", signup)

    with pytest.raises(HTTPException) as exc_info:
        await registration.register(_register_payload("Existing@Example.com"), db)

    assert exc_info.value.status_code == 409
    assert "đã được đăng ký" in exc_info.value.detail
    signup.assert_not_awaited()


@pytest.mark.asyncio
async def test_register_allows_email_after_deleted_auth_identity_and_binds_invite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid4())
    invitation = SimpleNamespace(id=str(uuid4()))
    db = AsyncMock()
    upstream_response = httpx.Response(
        status_code=200,
        json={"user": {"id": user_id, "email": "again@example.com"}},
    )
    active_user_lookup = AsyncMock(side_effect=[None, user_id])
    bind_invitation = AsyncMock()

    _patch_registration_basics(monkeypatch, invitation=invitation)
    monkeypatch.setattr(
        registration, "get_active_auth_user_id_by_email", active_user_lookup
    )
    monkeypatch.setattr(
        registration,
        "supabase_post",
        AsyncMock(return_value=upstream_response),
    )
    monkeypatch.setattr(
        registration, "bind_invitation_to_registration", bind_invitation
    )

    response = await registration.register(_register_payload("Again@Example.com"), db)

    assert response.otp_expires_in_seconds == registration.EMAIL_OTP_EXPIRE_SECONDS
    assert active_user_lookup.await_count == 2
    bind_invitation.assert_awaited_once_with(
        db,
        invitation_id=invitation.id,
        user_id=user_id,
        email="again@example.com",
    )


@pytest.mark.asyncio
async def test_register_rejects_obfuscated_duplicate_signup_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    upstream_response = httpx.Response(
        status_code=200,
        json={
            "user": {
                "id": str(uuid4()),
                "email": "existing@example.com",
            }
        },
    )

    _patch_registration_basics(monkeypatch)
    monkeypatch.setattr(
        registration,
        "get_active_auth_user_id_by_email",
        AsyncMock(side_effect=[None, "different-persisted-id"]),
    )
    monkeypatch.setattr(
        registration,
        "supabase_post",
        AsyncMock(return_value=upstream_response),
    )

    with pytest.raises(HTTPException) as exc_info:
        await registration.register(_register_payload("existing@example.com"), db)

    assert exc_info.value.status_code == 409


def test_expired_token_error_is_translated_to_vietnamese() -> None:
    assert common.translate_supabase_error("Token has expired or is invalid") == (
        "Mã OTP không đúng hoặc đã hết hạn"
    )


@pytest.mark.asyncio
async def test_verify_registration_creates_only_an_invite_bound_pre_auth_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid4())
    invitation = SimpleNamespace(id=str(uuid4()))
    db = AsyncMock()
    upstream_response = httpx.Response(
        status_code=200,
        json={
            "access_token": "supabase-access-token",
            "refresh_token": "supabase-refresh-token",
            "user": {
                "id": user_id,
                "email": "pending@example.com",
                "user_metadata": {"username": "PendingUser"},
            },
        },
    )
    pending_profile = SimpleNamespace(
        id=user_id,
        role="viewer",
        account_status="pending",
    )
    create_flow = AsyncMock(return_value=str(uuid4()))

    monkeypatch.setattr(registration, "ensure_supabase_auth_configured", lambda: None)
    monkeypatch.setattr(registration, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(registration, "clear_rate_limit", AsyncMock())
    monkeypatch.setattr(
        registration,
        "supabase_post",
        AsyncMock(return_value=upstream_response),
    )
    monkeypatch.setattr(
        registration,
        "get_bound_invitation",
        AsyncMock(return_value=invitation),
    )
    monkeypatch.setattr(
        registration,
        "get_or_create_profile",
        AsyncMock(return_value=pending_profile),
    )
    monkeypatch.setattr(registration, "create_flow_session", create_flow)

    api_response = Response()
    result = await registration.verify_register_otp(
        VerifyOtpRequest(email="pending@example.com", otp="123456"),
        Request({"type": "http", "headers": []}),
        api_response,
        db,
    )

    assert isinstance(result, MessageResponse)
    assert "xác thực" in result.message.lower()
    create_flow.assert_awaited_once_with(
        db,
        api_response,
        user_id=user_id,
        email="pending@example.com",
        flow_type="onboarding",
        invitation_id=invitation.id,
        supabase_access_token="supabase-access-token",
        supabase_refresh_token="supabase-refresh-token",
    )


@pytest.mark.asyncio
async def test_verify_registration_cannot_continue_without_bound_invitation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = str(uuid4())
    db = AsyncMock()
    upstream_response = httpx.Response(
        status_code=200,
        json={
            "access_token": "supabase-access-token",
            "refresh_token": "supabase-refresh-token",
            "user": {"id": user_id, "email": "member@example.com"},
        },
    )
    create_flow = AsyncMock()

    monkeypatch.setattr(registration, "ensure_supabase_auth_configured", lambda: None)
    monkeypatch.setattr(registration, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(registration, "clear_rate_limit", AsyncMock())
    monkeypatch.setattr(
        registration,
        "supabase_post",
        AsyncMock(return_value=upstream_response),
    )
    monkeypatch.setattr(
        registration,
        "get_bound_invitation",
        AsyncMock(
            side_effect=HTTPException(
                status_code=403,
                detail="Đăng ký không còn lời mời hợp lệ.",
            )
        ),
    )
    monkeypatch.setattr(registration, "create_flow_session", create_flow)

    with pytest.raises(HTTPException) as exc_info:
        await registration.verify_register_otp(
            VerifyOtpRequest(email="member@example.com", otp="123456"),
            Request({"type": "http", "headers": []}),
            Response(),
            db,
        )

    assert exc_info.value.status_code == 403
    create_flow.assert_not_awaited()
