from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request, Response

from app.routers.auth import mfa as mfa_router
from app.services.auth_flow_service import (
    create_flow_session,
    purge_expired_auth_flows,
    validate_google_oauth_state,
)
from app.services.mfa_service import use_recovery_code
from app.services.invitation_service import (
    bind_invitation_to_registration,
    consume_invitation,
)


class ScalarResult:
    def __init__(self, value: object) -> None:
        self.value = value

    def scalar_one_or_none(self) -> object:
        return self.value


@pytest.mark.asyncio
async def test_flow_session_encrypts_upstream_credentials_before_persistence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    db.add = Mock()
    response = Response()
    user_id = str(uuid4())

    monkeypatch.setattr(
        "app.services.auth_flow_service.encrypt_credential",
        lambda value, *, purpose: f"ciphertext:{purpose}:{len(value)}",
    )
    monkeypatch.setattr(
        "app.services.auth_flow_service.settings.auth_cookie_secure", False
    )

    await create_flow_session(
        db,
        response,
        user_id=user_id,
        email="Member@Example.com",
        flow_type="onboarding",
        invitation_id=str(uuid4()),
        supabase_access_token="upstream-access-secret",
        supabase_refresh_token="upstream-refresh-secret",
    )

    stored = db.add.call_args.args[0]
    assert stored.email == "member@example.com"
    assert stored.completed_steps == []
    assert stored.supabase_access_token_ciphertext.startswith(
        "ciphertext:supabase-access-token:"
    )
    assert stored.supabase_refresh_token_ciphertext.startswith(
        "ciphertext:supabase-refresh-token:"
    )
    assert "upstream-access-secret" not in repr(stored.__dict__)
    assert "upstream-refresh-secret" not in repr(stored.__dict__)
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "samesite=lax" in response.headers["set-cookie"].lower()
    assert "max-age=900" in response.headers["set-cookie"].lower()
    assert "secure" not in response.headers["set-cookie"].lower()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_expired_or_consumed_flow_credentials_are_purged() -> None:
    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(rowcount=2)

    removed = await purge_expired_auth_flows(db)

    statement = " ".join(str(db.execute.await_args.args[0]).lower().split())
    assert "delete from auth_flow_sessions" in statement
    assert "expires_at <= now() or consumed_at is not null" in statement
    assert removed == 2
    db.commit.assert_awaited_once()


def test_google_oauth_state_requires_exact_state_and_fresh_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    nonce_ciphertext = "encrypted-nonce"
    verifier_ciphertext = "encrypted-verifier"
    state = "correct-state-value"
    import hashlib

    flow = SimpleNamespace(
        oauth_state_hash=hashlib.sha256(state.encode()).hexdigest(),
        oauth_nonce_ciphertext=nonce_ciphertext,
        oauth_pkce_verifier_ciphertext=verifier_ciphertext,
        oauth_started_at=datetime.now(timezone.utc),
        oauth_consumed_at=None,
    )

    def decrypt(value: str, *, purpose: str) -> str:
        if value == nonce_ciphertext:
            return "nonce-value"
        if value == verifier_ciphertext:
            return "pkce-verifier"
        raise AssertionError((value, purpose))

    monkeypatch.setattr("app.services.auth_flow_service.decrypt_credential", decrypt)

    assert validate_google_oauth_state(flow, state) == (
        "nonce-value",
        "pkce-verifier",
    )
    with pytest.raises(HTTPException) as mismatch:
        validate_google_oauth_state(flow, "attacker-state")
    assert mismatch.value.status_code == 400

    flow.oauth_started_at = datetime.now(timezone.utc) - timedelta(minutes=6)
    with pytest.raises(HTTPException) as expired:
        validate_google_oauth_state(flow, state)
    assert expired.value.status_code == 400


@pytest.mark.asyncio
async def test_recovery_code_consumption_is_atomic_and_single_use() -> None:
    class Result:
        def first(self):
            return SimpleNamespace(id=str(uuid4()))

    db = AsyncMock()
    db.execute.return_value = Result()

    with patch(
        "app.services.mfa_service._recovery_hash",
        return_value="peppered-code-hash",
    ):
        await use_recovery_code(
            db,
            user_id=str(uuid4()),
            raw_code="ABCD-EFGH-IJKL-MNOP",
        )

    statement = str(db.execute.await_args.args[0]).lower()
    parameters = db.execute.await_args.args[1]
    assert "used_at is null" in statement
    assert "returning id" in statement
    assert parameters["code_hash"] == "peppered-code-hash"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_used_or_unknown_recovery_code_is_rejected() -> None:
    class EmptyResult:
        def first(self):
            return None

    db = AsyncMock()
    db.execute.return_value = EmptyResult()

    with patch(
        "app.services.mfa_service._recovery_hash",
        return_value="peppered-code-hash",
    ):
        with pytest.raises(HTTPException) as exc_info:
            await use_recovery_code(
                db,
                user_id=str(uuid4()),
                raw_code="ABCD-EFGH-IJKL-MNOP",
            )

    assert exc_info.value.status_code == 400
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_invitation_binding_is_exact_and_atomic() -> None:
    class Result:
        def first(self):
            return SimpleNamespace(id=str(uuid4()))

    db = AsyncMock()
    db.execute.return_value = Result()
    invitation_id = str(uuid4())
    user_id = str(uuid4())

    await bind_invitation_to_registration(
        db,
        invitation_id=invitation_id,
        user_id=user_id,
        email="Member@Example.com",
    )

    statement = " ".join(str(db.execute.await_args.args[0]).lower().split())
    parameters = db.execute.await_args.args[1]
    assert "where id = cast(:id as uuid)" in statement
    assert "lower(email) = lower(:email)" in statement
    assert "consumed_at is null" in statement
    assert "revoked_at is null" in statement
    assert "expires_at > now()" in statement
    assert (
        "registered_user_id is null or registered_user_id = cast(:uid as uuid)"
        in statement
    )
    assert "returning id" in statement
    assert parameters == {
        "id": invitation_id,
        "uid": user_id,
        "email": "Member@Example.com",
    }
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_invitation_consumption_requires_exact_bound_identity() -> None:
    class Result:
        def first(self):
            return SimpleNamespace(id=str(uuid4()))

    db = AsyncMock()
    db.execute.return_value = Result()
    invitation_id = str(uuid4())
    user_id = str(uuid4())

    await consume_invitation(
        db,
        invitation_id=invitation_id,
        user_id=user_id,
        email="Member@Example.com",
    )

    statement = " ".join(str(db.execute.await_args.args[0]).lower().split())
    parameters = db.execute.await_args.args[1]
    assert "where id = cast(:id as uuid)" in statement
    assert "registered_user_id = cast(:uid as uuid)" in statement
    assert "lower(email) = lower(:email)" in statement
    assert "role = 'viewer'::user_role" in statement
    assert "consumed_at is null" in statement
    assert "revoked_at is null" in statement
    assert "expires_at > now()" in statement
    assert "returning id" in statement
    assert parameters == {
        "id": invitation_id,
        "uid": user_id,
        "email": "Member@Example.com",
    }
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_pending_account_cannot_finish_stale_onboarding_flow() -> None:
    user_id = str(uuid4())
    flow = SimpleNamespace(
        id=str(uuid4()),
        user_id=user_id,
        email="disabled@example.com",
        invitation_id=str(uuid4()),
    )
    profile = SimpleNamespace(
        id=user_id,
        role="viewer",
        account_status="disabled",
    )
    db = AsyncMock()
    db.execute.return_value = ScalarResult(profile)
    consume = AsyncMock()
    issue_token = AsyncMock()

    with (
        patch(
            "app.routers.auth.mfa.mark_onboarding_recovery_codes_confirmed",
            new=AsyncMock(return_value=flow),
        ),
        patch("app.routers.auth.mfa.consume_invitation", new=consume),
        patch("app.routers.auth.mfa.issue_internal_token", new=issue_token),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await mfa_router.confirm_onboarding_recovery_codes(
                Request({"type": "http", "headers": []}),
                Response(),
                db,
            )

    assert exc_info.value.status_code == 403
    assert "vô hiệu hóa" in exc_info.value.detail
    assert db.execute.await_count == 1
    consume.assert_not_awaited()
    issue_token.assert_not_awaited()
    db.commit.assert_not_awaited()
