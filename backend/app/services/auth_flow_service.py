"""Short-lived, opaque pre-auth sessions for onboarding and login MFA."""

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import decrypt_credential, encrypt_credential
from app.core.config import settings
from app.models.auth_flow_session import AuthFlowSession

FLOW_COOKIE_NAME = "tpro_flow_session"
_ACCESS_PURPOSE = "supabase-access-token"
_REFRESH_PURPOSE = "supabase-refresh-token"
_OAUTH_NONCE_PURPOSE = "google-oauth-nonce"
_OAUTH_VERIFIER_PURPOSE = "google-oauth-pkce-verifier"
_RECOVERY_DELIVERY_PURPOSE = "recovery-code-delivery"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def purge_expired_auth_flows(
    db: AsyncSession,
    *,
    commit: bool = True,
) -> int:
    """Permanently remove expired/consumed rows that contain credentials."""
    result = await db.execute(
        text(
            "delete from auth_flow_sessions"
            " where expires_at <= now() or consumed_at is not null"
        )
    )
    rowcount = getattr(result, "rowcount", 0)
    removed = rowcount if isinstance(rowcount, int) and rowcount > 0 else 0
    if commit:
        await db.commit()
    return removed


async def create_flow_session(
    db: AsyncSession,
    response: Response,
    *,
    user_id: str,
    email: str,
    flow_type: str,
    supabase_access_token: str,
    supabase_refresh_token: str,
    invitation_id: str | None = None,
) -> str:
    """Create a pre-auth flow without exposing upstream tokens to the browser."""
    raw_token = secrets.token_urlsafe(32)
    ttl_minutes = (
        settings.onboarding_session_minutes
        if flow_type == "onboarding"
        else settings.login_mfa_session_minutes
    )
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)

    # Keep credential-bearing rows for no longer than their functional TTL,
    # including flows left behind by a crashed callback/response.
    await purge_expired_auth_flows(db, commit=False)
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"auth-flow:{user_id}:{flow_type}"},
    )
    # A user can have only one useful flow of each kind. Removing older rows
    # also limits how long encrypted upstream credentials remain at rest.
    await db.execute(
        text(
            "delete from auth_flow_sessions"
            " where user_id = cast(:uid as uuid) and flow_type = :flow_type"
        ),
        {"uid": user_id, "flow_type": flow_type},
    )
    session = AuthFlowSession(
        id=str(uuid4()),
        session_token_hash=_token_hash(raw_token),
        user_id=user_id,
        email=email.strip().lower(),
        invitation_id=invitation_id,
        flow_type=flow_type,
        completed_steps=[],
        aal="aal1",
        supabase_access_token_ciphertext=encrypt_credential(
            supabase_access_token, purpose=_ACCESS_PURPOSE
        ),
        supabase_refresh_token_ciphertext=encrypt_credential(
            supabase_refresh_token, purpose=_REFRESH_PURPOSE
        ),
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()

    response.set_cookie(
        key=FLOW_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        max_age=ttl_minutes * 60,
        path="/",
    )
    return session.id


async def validate_flow_session(
    request: Request,
    db: AsyncSession,
    *,
    required_flow_type: str | None = None,
) -> AuthFlowSession:
    raw_token = request.cookies.get(FLOW_COOKIE_NAME)
    if not raw_token:
        raise _invalid_flow()

    result = await db.execute(
        select(AuthFlowSession).where(
            AuthFlowSession.session_token_hash == _token_hash(raw_token),
            AuthFlowSession.expires_at > datetime.now(timezone.utc),
            AuthFlowSession.consumed_at.is_(None),
        )
    )
    flow = result.scalar_one_or_none()
    if flow is None:
        raise _invalid_flow()
    if required_flow_type and flow.flow_type != required_flow_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Luồng xác thực không hợp lệ.",
        )
    return flow


def read_upstream_credentials(flow: AuthFlowSession) -> tuple[str, str]:
    return (
        decrypt_credential(
            flow.supabase_access_token_ciphertext, purpose=_ACCESS_PURPOSE
        ),
        decrypt_credential(
            flow.supabase_refresh_token_ciphertext, purpose=_REFRESH_PURPOSE
        ),
    )


async def advance_flow_step(db: AsyncSession, session_id: str, step: str) -> None:
    """Append a non-secret state marker once."""
    await db.execute(
        text(
            "update auth_flow_sessions"
            " set completed_steps = array_append(completed_steps, :step)"
            " where id = cast(:id as uuid)"
            " and not (completed_steps @> array[:step]::text[])"
        ),
        {"step": step, "id": session_id},
    )
    await db.commit()


async def begin_google_oauth(
    db: AsyncSession,
    flow: AuthFlowSession,
) -> tuple[str, str, str]:
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    await db.execute(
        text(
            "update auth_flow_sessions set"
            " oauth_state_hash = :state_hash,"
            " oauth_nonce_ciphertext = :nonce,"
            " oauth_pkce_verifier_ciphertext = :verifier,"
            " oauth_started_at = now(), oauth_consumed_at = null"
            " where id = cast(:id as uuid) and consumed_at is null"
        ),
        {
            "id": flow.id,
            "state_hash": _token_hash(state),
            "nonce": encrypt_credential(nonce, purpose=_OAUTH_NONCE_PURPOSE),
            "verifier": encrypt_credential(verifier, purpose=_OAUTH_VERIFIER_PURPOSE),
        },
    )
    await db.commit()
    return state, nonce, verifier


def validate_google_oauth_state(
    flow: AuthFlowSession,
    supplied_state: str,
) -> tuple[str, str]:
    if (
        not flow.oauth_state_hash
        or not flow.oauth_nonce_ciphertext
        or not flow.oauth_pkce_verifier_ciphertext
    ):
        raise _invalid_oauth()
    if flow.oauth_started_at is None or flow.oauth_started_at < datetime.now(
        timezone.utc
    ) - timedelta(minutes=5):
        raise _invalid_oauth()
    if flow.oauth_consumed_at is not None:
        raise _invalid_oauth()
    if not hmac.compare_digest(flow.oauth_state_hash, _token_hash(supplied_state)):
        raise _invalid_oauth()
    return (
        decrypt_credential(flow.oauth_nonce_ciphertext, purpose=_OAUTH_NONCE_PURPOSE),
        decrypt_credential(
            flow.oauth_pkce_verifier_ciphertext, purpose=_OAUTH_VERIFIER_PURPOSE
        ),
    )


async def claim_google_oauth(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(
        text(
            "update auth_flow_sessions set oauth_consumed_at = now()"
            " where id = cast(:id as uuid) and oauth_consumed_at is null"
            " and oauth_started_at > now() - interval '5 minutes' returning id"
        ),
        {"id": session_id},
    )
    if result.first() is None:
        raise _invalid_oauth()
    await db.commit()


async def finish_google_oauth(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(
        text(
            "update auth_flow_sessions set"
            " oauth_state_hash = null, oauth_nonce_ciphertext = null,"
            " oauth_pkce_verifier_ciphertext = null, oauth_started_at = null,"
            " oauth_consumed_at = null,"
            " completed_steps = case when completed_steps @> array['google_linked']::text[]"
            " then completed_steps else array_append(completed_steps, 'google_linked') end"
            " where id = cast(:id as uuid) and consumed_at is null returning id"
        ),
        {"id": session_id},
    )
    if result.first() is None:
        raise _invalid_flow()
    await db.commit()


async def consume_flow_session(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(
        text(
            "update auth_flow_sessions set consumed_at = now()"
            " where id = cast(:id as uuid) and consumed_at is null"
            " and expires_at > now() returning id"
        ),
        {"id": session_id},
    )
    if result.first() is None:
        raise _invalid_flow()


async def upgrade_onboarding_after_totp(
    db: AsyncSession,
    session_id: str,
    *,
    supabase_access_token: str,
    supabase_refresh_token: str,
    codes: list[str],
) -> None:
    ciphertext = encrypt_credential(
        json.dumps(codes, separators=(",", ":")), purpose=_RECOVERY_DELIVERY_PURPOSE
    )
    result = await db.execute(
        text(
            "update auth_flow_sessions set aal = 'aal2',"
            " supabase_access_token_ciphertext = :access_token,"
            " supabase_refresh_token_ciphertext = :refresh_token,"
            " recovery_codes_ciphertext = :codes"
            " where id = cast(:id as uuid) and flow_type = 'onboarding'"
            " and aal = 'aal1' and consumed_at is null and expires_at > now()"
            " returning id"
        ),
        {
            "id": session_id,
            "codes": ciphertext,
            "access_token": encrypt_credential(
                supabase_access_token, purpose=_ACCESS_PURPOSE
            ),
            "refresh_token": encrypt_credential(
                supabase_refresh_token, purpose=_REFRESH_PURPOSE
            ),
        },
    )
    if result.first() is None:
        raise _invalid_flow()


async def take_onboarding_recovery_codes(
    request: Request, db: AsyncSession
) -> list[str]:
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    result = await db.execute(
        text(
            "update auth_flow_sessions set"
            " recovery_codes_retrieved_at = coalesce(recovery_codes_retrieved_at, now())"
            " where id = cast(:id as uuid) and aal = 'aal2'"
            " and recovery_codes_ciphertext is not null"
            " returning recovery_codes_ciphertext"
        ),
        {"id": flow.id},
    )
    row = result.first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mã khôi phục không còn hiệu lực.",
        )
    await db.commit()
    raw = decrypt_credential(
        str(row._mapping["recovery_codes_ciphertext"]),
        purpose=_RECOVERY_DELIVERY_PURPOSE,
    )
    data = json.loads(raw)
    if not isinstance(data, list) or not all(isinstance(code, str) for code in data):
        raise _invalid_flow()
    return data


async def mark_onboarding_recovery_codes_confirmed(
    request: Request, db: AsyncSession
) -> AuthFlowSession:
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    result = await db.execute(
        text(
            "update auth_flow_sessions set recovery_codes_confirmed_at = now(),"
            " recovery_codes_ciphertext = null"
            " where id = cast(:id as uuid) and aal = 'aal2'"
            " and recovery_codes_retrieved_at is not null returning id"
        ),
        {"id": flow.id},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vui lòng xem và lưu mã khôi phục trước khi hoàn tất.",
        )
    return flow


async def delete_flow_session(
    db: AsyncSession, session_id: str, response: Response
) -> None:
    await db.execute(
        text("delete from auth_flow_sessions where id = cast(:id as uuid)"),
        {"id": session_id},
    )
    await db.commit()
    response.delete_cookie(
        FLOW_COOKIE_NAME,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _invalid_flow() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Phiên xác thực tạm thời không tồn tại hoặc đã hết hạn.",
    )


def _invalid_oauth() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Phiên liên kết Google không hợp lệ hoặc đã hết hạn.",
    )
