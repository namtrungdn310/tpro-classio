"""Shared helpers for all auth router sub-modules."""

import logging
import re
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.device_sessions import (
    DeviceSessionContext,
    hash_device_value,
    read_supabase_session_id,
)
from app.core.http import supabase_auth_client
from app.core.security import create_access_token
from app.models.user import Profile
from app.models.user_device_session import UserDeviceSession
from app.schemas.auth import TokenResponse
from app.services.auth_admin_service import get_active_auth_user_by_email

logger = logging.getLogger("tpro_classio.auth")


# ---------------------------------------------------------------------------
# Email / username normalization
# ---------------------------------------------------------------------------


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_owner_email(email: str | None) -> bool:
    return bool(email) and normalize_email(email) == normalize_email(
        settings.owner_admin_email
    )


def normalize_username(value: str | None) -> str | None:
    if not value:
        return None
    username = re.sub(r"[^A-Za-z0-9]", "", value.strip())
    if len(username) < 3:
        return None
    return username[:20]


def fallback_username(email: str, user_id: str) -> str:
    local_part = email.split("@", 1)[0]
    normalized = normalize_username(local_part)
    if normalized:
        return normalized
    return f"user{user_id.replace('-', '')[:8]}"


async def ensure_unique_username(db: AsyncSession, username: str, user_id: str) -> str:
    normalized = username[:20]
    candidate = normalized
    suffix = 1
    while True:
        result = await db.execute(
            select(Profile.id).where(
                Profile.id != user_id,
                func.lower(Profile.username) == candidate.lower(),
            )
        )
        if result.scalar_one_or_none() is None:
            return candidate
        suffix_text = str(suffix)
        candidate = f"{normalized[: 20 - len(suffix_text)]}{suffix_text}"
        suffix += 1


# ---------------------------------------------------------------------------
# Supabase HTTP helpers
# ---------------------------------------------------------------------------


def supabase_auth_headers(access_token: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": settings.supabase_anon_key,
        "Content-Type": "application/json",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def ensure_supabase_auth_configured() -> None:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Chưa cấu hình Supabase Auth",
        )


async def supabase_post(url: str, **kwargs) -> httpx.Response:
    try:
        return await supabase_auth_client.post(url, **kwargs)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Supabase Auth phản hồi quá lâu. Hãy thử lại sau vài giây.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không kết nối được Supabase Auth. Hãy kiểm tra mạng hoặc cấu hình Supabase.",
        ) from exc


async def supabase_put(url: str, **kwargs) -> httpx.Response:
    try:
        return await supabase_auth_client.put(url, **kwargs)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Supabase Auth phản hồi quá lâu. Hãy thử lại sau vài giây.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không kết nối được Supabase Auth. Hãy kiểm tra mạng hoặc cấu hình Supabase.",
        ) from exc


async def revoke_supabase_access_token(
    access_token: str,
    *,
    scope: str,
    operation: str,
) -> bool:
    """Revoke a Supabase session without ever logging its bearer credential."""
    if scope not in {"local", "others", "global"}:
        raise ValueError("Unsupported Supabase logout scope")
    if not access_token:
        logger.warning(
            "Supabase session cleanup skipped for %s: no credential", operation
        )
        return False
    try:
        response = await supabase_post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/logout",
            params={"scope": scope},
            headers=supabase_auth_headers(access_token),
        )
    except HTTPException:
        logger.warning("Supabase session cleanup failed for %s", operation)
        return False
    if response.status_code >= 400:
        log_supabase_auth_failure(operation, response)
        return False
    return True


async def revoke_temporary_supabase_session(auth_data: dict, *, operation: str) -> bool:
    access_token = auth_data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        logger.warning(
            "Supabase session cleanup skipped for %s: no access token", operation
        )
        return False
    return await revoke_supabase_access_token(
        access_token,
        scope="local",
        operation=operation,
    )


async def revoke_supabase_session_by_refresh_token(
    refresh_token: str,
    *,
    operation: str,
) -> bool:
    """Rotate an HttpOnly refresh credential once, then revoke that session.

    Invalid/reused refresh tokens are already unusable and count as revoked.
    Transient upstream failures return False; callers must still invalidate the
    local application session so this credential cannot regain app access.
    """
    try:
        response = await supabase_post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/token",
            params={"grant_type": "refresh_token"},
            headers=supabase_auth_headers(),
            json={"refresh_token": refresh_token},
        )
    except HTTPException:
        logger.warning("Supabase session cleanup failed for %s", operation)
        return False
    if response.status_code in {
        status.HTTP_400_BAD_REQUEST,
        status.HTTP_401_UNAUTHORIZED,
    }:
        return True
    if response.status_code >= 400:
        log_supabase_auth_failure(operation, response)
        return False
    auth_data = response.json()
    access_token = (
        auth_data.get("access_token") if isinstance(auth_data, dict) else None
    )
    if not isinstance(access_token, str) or not access_token:
        logger.warning(
            "Supabase session cleanup failed for %s: invalid response", operation
        )
        return False
    return await revoke_supabase_access_token(
        access_token,
        scope="local",
        operation=operation,
    )


# ---------------------------------------------------------------------------
# Error reading / translation
# ---------------------------------------------------------------------------


def read_supabase_error(response: httpx.Response, fallback: str) -> str:
    try:
        data = response.json()
    except ValueError:
        body = response.text.strip()
        return translate_supabase_error(body[:500], fallback=fallback)
    if not isinstance(data, dict):
        return translate_supabase_error(str(data)[:500], fallback=fallback)
    for key in ("msg", "message", "error_description", "error", "error_code", "code"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return translate_supabase_error(value.strip(), fallback=fallback)
    detail = data.get("detail")
    if isinstance(detail, str) and detail.strip():
        return translate_supabase_error(detail.strip(), fallback=fallback)
    if isinstance(detail, list) and detail:
        return translate_supabase_error(str(detail[0])[:500], fallback=fallback)
    return fallback


def translate_supabase_error(detail: str, *, fallback: str | None = None) -> str:
    nd = detail.lower()
    if "upstream request timeout" in nd:
        return "Gửi email OTP quá lâu. Hãy thử lại sau vài giây."
    if "email rate limit" in nd or "rate limit" in nd:
        return "Gửi email quá nhiều lần. Hãy thử lại sau ít phút."
    if "invalid login credentials" in nd:
        return "Email hoặc mật khẩu không đúng"
    if "email not confirmed" in nd:
        return "Email chưa được xác thực"
    if "user already registered" in nd or "already registered" in nd:
        return "Email này đã được đăng ký"
    if "otp" in nd and ("expired" in nd or "invalid" in nd):
        return "Mã OTP không đúng hoặc đã hết hạn"
    if "token" in nd and ("expired" in nd or "invalid" in nd):
        return "Mã OTP không đúng hoặc đã hết hạn"
    # Never reflect arbitrary upstream bodies into logs or browser responses.
    return fallback or "Không thể hoàn tất yêu cầu xác thực."


def log_supabase_auth_failure(action: str, response: httpx.Response) -> None:
    logger.warning(
        "Supabase Auth %s failed with status %s",
        action,
        response.status_code,
    )


def raise_auth_error(detail: str = "Yêu cầu xác thực không hợp lệ") -> None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def read_supabase_access_token(auth_data: dict) -> str:
    access_token = auth_data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise_auth_error("Không thể xác thực mã đặt lại mật khẩu")
    return access_token  # type: ignore[return-value]


def read_auth_session(auth_data: dict, fallback_email: str) -> tuple[str, str, str]:
    user = auth_data.get("user") or {}
    user_id = user.get("id")
    email = user.get("email") or fallback_email
    refresh_token = auth_data.get("refresh_token")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ",
        )
    if not isinstance(email, str) or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ",
        )
    if not isinstance(refresh_token, str) or not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không tạo được phiên đăng nhập",
        )
    return user_id, email, refresh_token


def read_user_metadata(auth_data: dict) -> tuple[str | None, str | None]:
    user = auth_data.get("user") or {}
    metadata = user.get("user_metadata") or {}
    if not isinstance(metadata, dict):
        return None, None
    username = (
        metadata.get("username") or metadata.get("full_name") or metadata.get("name")
    )
    avatar_url = metadata.get("avatar_url") or metadata.get("picture")
    return (
        username if isinstance(username, str) and username.strip() else None,
        avatar_url if isinstance(avatar_url, str) and avatar_url.strip() else None,
    )


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------


async def lock_registration_email(db: AsyncSession, email: str) -> None:
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:email, 0))"),
        {"email": email},
    )


async def get_active_auth_user_id_by_email(db: AsyncSession, email: str) -> str | None:
    user = await get_active_auth_user_by_email(email)
    return user.id if user is not None else None


async def is_auth_email_confirmed(db: AsyncSession, email: str) -> bool:
    user = await get_active_auth_user_by_email(email)
    return bool(user and user.email_confirmed)


async def get_profile_status_by_email(db: AsyncSession, email: str) -> str | None:
    user = await get_active_auth_user_by_email(email)
    if user is None:
        return None
    result = await db.execute(select(Profile.account_status).where(Profile.id == user.id))
    account_status = result.scalar_one_or_none()
    return account_status if isinstance(account_status, str) else None


async def get_or_create_profile(
    db: AsyncSession,
    user_id: str,
    email: str,
    username: str | None = None,
    full_name: str | None = None,
) -> Profile:
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    owner = is_owner_email(email)

    if profile is None:
        for attempt in range(3):
            safe_username = await ensure_unique_username(
                db,
                normalize_username(username or full_name)
                or fallback_username(email, user_id),
                user_id,
            )
            candidate = Profile(
                id=user_id,
                role="admin" if owner else "viewer",
                username=safe_username,
                full_name=safe_username,
                account_status="active" if owner else "pending",
            )
            db.add(candidate)
            try:
                await db.commit()
                await db.refresh(candidate)
                return candidate
            except IntegrityError as error:
                await db.rollback()
                concurrent_result = await db.execute(
                    select(Profile).where(Profile.id == user_id)
                )
                profile = concurrent_result.scalar_one_or_none()
                if profile is not None:
                    break
                if attempt == 2:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Không thể tạo hồ sơ tài khoản. Vui lòng thử lại.",
                    ) from error

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể tạo hồ sơ tài khoản. Vui lòng thử lại.",
        )

    changed = False
    if owner and profile.role != "admin":
        profile.role = "admin"
        changed = True
    if owner and profile.account_status != "active":
        profile.account_status = "active"
        profile.approved_at = datetime.now(timezone.utc)
        profile.disabled_at = None
        profile.disabled_by = None
        changed = True
    if not profile.username:
        profile.username = await ensure_unique_username(
            db,
            normalize_username(username or full_name)
            or fallback_username(email, user_id),
            user_id,
        )
        changed = True
    if not profile.full_name:
        profile.full_name = profile.username
        changed = True
    if changed:
        await db.commit()
        await db.refresh(profile)
    return profile


def ensure_account_active(profile: Profile, email: str) -> None:
    if is_owner_email(email):
        return
    if profile.account_status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đang chờ hoàn tất onboarding.",
        )
    if profile.account_status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ tài khoản Dev.",
        )


# ---------------------------------------------------------------------------
# Device session / token
# ---------------------------------------------------------------------------


async def upsert_device_session(
    db: AsyncSession,
    *,
    user_id: str,
    device_type: str,
    device_id: str,
    refresh_token: str,
    supabase_access_token: str,
    user_agent: str,
    rotate_nonce: bool,
    existing_nonce: str | None = None,
    aal: str = "aal1",
    mfa_factor_id: str | None = None,
    mfa_verified_at: datetime | None = None,
    commit: bool = True,
) -> DeviceSessionContext:
    verified_at = mfa_verified_at or (
        datetime.now(timezone.utc) if aal == "aal2" else None
    )
    session_nonce = existing_nonce or str(uuid4())
    if rotate_nonce:
        session_nonce = str(uuid4())

    stmt = insert(UserDeviceSession).values(
        user_id=user_id,
        device_type=device_type,
        device_id_hash=hash_device_value(device_id),
        refresh_token_hash=hash_device_value(refresh_token),
        session_nonce=session_nonce,
        supabase_session_id=read_supabase_session_id(supabase_access_token),
        user_agent_hash=hash_device_value(user_agent or ""),
        aal=aal,
        mfa_factor_id=mfa_factor_id,
        mfa_verified_at=verified_at,
    )
    session_values: dict = {
        "device_id_hash": hash_device_value(device_id),
        "refresh_token_hash": hash_device_value(refresh_token),
        "session_nonce": session_nonce,
        "supabase_session_id": read_supabase_session_id(supabase_access_token),
        "user_agent_hash": hash_device_value(user_agent or ""),
        "last_seen_at": func.now(),
        "updated_at": func.now(),
        "aal": aal,
        "mfa_factor_id": mfa_factor_id,
    }
    if aal == "aal2":
        session_values["mfa_verified_at"] = verified_at
    if rotate_nonce:
        session_values["created_at"] = func.now()

    stmt = stmt.on_conflict_do_update(
        constraint="uq_user_device_sessions_slot",
        set_=session_values,
    )
    await db.execute(stmt)
    if commit:
        await db.commit()
    else:
        await db.flush()
    return DeviceSessionContext(device_type=device_type, session_nonce=session_nonce)


async def issue_internal_token(
    db: AsyncSession,
    user_id: str,
    email: str,
    refresh_token: str,
    session_context: DeviceSessionContext,
    username: str | None = None,
    avatar_url: str | None = None,
    profile: Profile | None = None,
    aal: str = "aal2",
) -> TokenResponse:
    if aal != "aal2":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Phiên chưa hoàn tất Google Authenticator.",
        )
    profile = profile or await get_or_create_profile(db, user_id, email, username)
    ensure_account_active(profile, email)
    owner = is_owner_email(email)
    display_name = profile.username or profile.full_name
    # Prefer stored avatar_url from profile over passed-in value
    resolved_avatar = profile.avatar_url or avatar_url
    access_token = create_access_token(
        {
            "sub": str(profile.id),
            "role": profile.role,
            "email": email,
            "username": profile.username,
            "full_name": display_name,
            "avatar_url": resolved_avatar,
            "is_owner": owner,
            "device_type": session_context.device_type,
            "session_nonce": session_context.session_nonce,
            "aal": "aal2",
        }
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=profile.role,
        is_owner=owner,
    )


async def record_account_security_event(
    db: AsyncSession,
    *,
    actor_user_id: str | None,
    target_user_id: str,
    action: str,
    previous_role: str | None = None,
    next_role: str | None = None,
    previous_status: str | None = None,
    next_status: str | None = None,
    previous_username: str | None = None,
    next_username: str | None = None,
) -> None:
    await db.execute(
        text(
            """
            insert into account_security_events (
                actor_user_id, target_user_id, action,
                previous_role, next_role,
                previous_status, next_status,
                previous_username, next_username
            ) values (
                cast(:actor_user_id as uuid), cast(:target_user_id as uuid), :action,
                cast(:previous_role as user_role), cast(:next_role as user_role),
                :previous_status, :next_status,
                :previous_username, :next_username
            )
            """
        ),
        {
            "actor_user_id": actor_user_id,
            "target_user_id": target_user_id,
            "action": action,
            "previous_role": previous_role,
            "next_role": next_role,
            "previous_status": previous_status,
            "next_status": next_status,
            "previous_username": previous_username,
            "next_username": next_username,
        },
    )
