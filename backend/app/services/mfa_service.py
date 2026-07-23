"""Supabase-native TOTP MFA and application recovery codes.

TOTP secrets and replay prevention stay inside Supabase Auth. The application
stores only the provider factor id. Recovery codes are high-entropy, HMACed
with the dedicated auth encryption key and consumed atomically.
"""

import base64
import io
import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import jwt
import httpx
import qrcode
from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import keyed_secret_hash
from app.core.config import settings
from app.core.http import supabase_auth_client
from app.models.recovery_code import AuthRecoveryCode
from app.models.totp_factor import AuthTotpFactor

_RECOVERY_CODE_COUNT = 10
_RECOVERY_HASH_PURPOSE = "recovery-code-hmac-v1"
logger = logging.getLogger("tpro_classio.auth.mfa")


def _headers(access_token: str) -> dict[str, str]:
    return {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }


def _build_display_totp_uri(provider_uri: str, user_email: str) -> str:
    """Return an Authenticator-friendly label without changing the TOTP secret.

    Supabase owns the factor secret and verification. Some local OAuth/MFA
    responses derive a noisy account label from the localhost origin, so the QR
    we show to the user rewrites only presentation fields: the otpauth label and
    issuer query parameter. All cryptographic parameters from Supabase are kept.
    """
    issuer = settings.totp_issuer.strip() or "TPRO English"
    email = user_email.strip().lower()
    try:
        parsed = urlsplit(provider_uri)
        if parsed.scheme != "otpauth" or parsed.netloc != "totp":
            return provider_uri
        params = dict(parse_qsl(parsed.query, keep_blank_values=True))
        params["issuer"] = issuer
        label = quote(f"{issuer}:{email}", safe="")
        return urlunsplit(("otpauth", "totp", f"/{label}", "", urlencode(params)))
    except ValueError:
        return provider_uri


async def _auth_request(
    method: str,
    path: str,
    access_token: str,
    *,
    json: dict | None = None,
) -> dict:
    try:
        response = await supabase_auth_client.request(
            method,
            f"{settings.supabase_url.rstrip('/')}/auth/v1{path}",
            headers=_headers(access_token),
            json=json,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dịch vụ xác thực hai bước tạm thời không khả dụng.",
        ) from exc
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể hoàn tất xác thực hai bước. Vui lòng thử lại.",
        )
    data = response.json()
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dịch vụ xác thực trả về dữ liệu không hợp lệ.",
        )
    return data


async def _delete_provider_factor(
    provider_factor_id: str,
    supabase_access_token: str,
) -> None:
    """Delete a native factor, treating an already-missing factor as success."""
    try:
        response = await supabase_auth_client.request(
            "DELETE",
            f"{settings.supabase_url.rstrip('/')}/auth/v1/factors/{provider_factor_id}",
            headers=_headers(supabase_access_token),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dịch vụ xác thực hai bước tạm thời không khả dụng.",
        ) from exc
    if response.status_code == status.HTTP_404_NOT_FOUND:
        return
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể làm mới thiết lập Google Authenticator.",
        )


async def _admin_delete_provider_factor(
    user_id: str,
    provider_factor_id: str,
) -> None:
    """Delete an interrupted verified factor with the backend-only admin API.

    Supabase correctly requires AAL2 to unenroll a verified factor through the
    user API. An expired onboarding flow has lost that AAL2 session, so this
    narrow recovery path uses the service role and immediately forces a fresh
    password session before onboarding continues.
    """
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa cấu hình quyền khôi phục Google Authenticator.",
        )
    try:
        response = await supabase_auth_client.request(
            "DELETE",
            (
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/"
                f"{user_id}/factors/{provider_factor_id}"
            ),
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dịch vụ xác thực hai bước tạm thời không khả dụng.",
        ) from exc
    if response.status_code == status.HTTP_404_NOT_FOUND:
        return
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể khôi phục thiết lập Google Authenticator bị gián đoạn.",
        )


async def enroll_totp(
    db: AsyncSession,
    *,
    user_id: str,
    user_email: str,
    supabase_access_token: str,
) -> dict[str, str]:
    # Serialize duplicate tabs/requests. Otherwise two native factors can be
    # created before the local unique(user_id) constraint is observed.
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"totp-enrollment:{user_id}"},
    )
    existing_result = await db.execute(
        select(AuthTotpFactor).where(AuthTotpFactor.user_id == user_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None and existing.verified_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản đã thiết lập Google Authenticator.",
        )
    if existing is not None:
        # Abandoned/unverified enrollment can be restarted safely.
        await _delete_provider_factor(
            existing.provider_factor_id,
            supabase_access_token,
        )
        await db.delete(existing)
        await db.flush()

    data = await _auth_request(
        "POST",
        "/factors",
        supabase_access_token,
        json={
            "factor_type": "totp",
            "friendly_name": f"{settings.totp_issuer} ({user_email})",
        },
    )
    factor_id = data.get("id")
    totp_data = data.get("totp")
    if not isinstance(factor_id, str) or not isinstance(totp_data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không nhận được dữ liệu Google Authenticator hợp lệ.",
        )
    uri = totp_data.get("uri")
    secret = totp_data.get("secret")
    if not all(isinstance(value, str) and value for value in (uri, secret)):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không nhận được mã thiết lập Google Authenticator.",
        )

    display_uri = _build_display_totp_uri(uri, user_email)
    qr_output = io.BytesIO()
    qrcode.make(display_uri).save(qr_output, format="PNG")
    qr_code = "data:image/png;base64," + base64.b64encode(qr_output.getvalue()).decode(
        "ascii"
    )

    factor = AuthTotpFactor(
        id=str(uuid4()),
        user_id=user_id,
        provider_factor_id=factor_id,
    )
    db.add(factor)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await _delete_provider_factor(factor_id, supabase_access_token)
        except HTTPException:
            logger.exception(
                "Failed to clean up Supabase TOTP factor after local persistence failure"
            )
        raise
    return {
        "factor_id": factor_id,
        "totp_uri": display_uri,
        "secret": secret,
        "qr_code_data_url": qr_code,
    }


async def verify_totp_code(
    db: AsyncSession,
    *,
    user_id: str,
    code: str,
    supabase_access_token: str,
) -> tuple[AuthTotpFactor, dict]:
    result = await db.execute(
        select(AuthTotpFactor).where(AuthTotpFactor.user_id == user_id)
    )
    factor = result.scalar_one_or_none()
    if factor is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tài khoản chưa thiết lập Google Authenticator.",
        )

    challenge = await _auth_request(
        "POST",
        f"/factors/{factor.provider_factor_id}/challenge",
        supabase_access_token,
        json={},
    )
    challenge_id = challenge.get("id")
    if not isinstance(challenge_id, str) or not challenge_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không tạo được thử thách xác thực hai bước.",
        )
    verified = await _auth_request(
        "POST",
        f"/factors/{factor.provider_factor_id}/verify",
        supabase_access_token,
        json={"challenge_id": challenge_id, "code": code},
    )
    assert_aal2_auth_response(verified, expected_user_id=user_id)
    factor.last_used_at = datetime.now(timezone.utc)
    await db.flush()
    return factor, verified


async def reset_incomplete_totp_enrollment(
    db: AsyncSession,
    *,
    user_id: str,
) -> None:
    """Reset a verified factor only when onboarding never completed.

    This lets an interrupted/expired recovery-code delivery restart instead of
    permanently stranding the account with no recoverable plaintext batch.
    """
    result = await db.execute(
        select(AuthTotpFactor).where(AuthTotpFactor.user_id == user_id)
    )
    factor = result.scalar_one_or_none()
    if factor is None:
        return
    await _admin_delete_provider_factor(user_id, factor.provider_factor_id)
    await db.delete(factor)
    await db.execute(
        text("delete from auth_recovery_codes where user_id = cast(:uid as uuid)"),
        {"uid": user_id},
    )
    await db.commit()


def assert_aal2_auth_response(auth_data: dict, *, expected_user_id: str) -> None:
    access_token = auth_data.get("access_token")
    refresh_token = auth_data.get("refresh_token")
    if not isinstance(access_token, str) or not isinstance(refresh_token, str):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Phiên AAL2 không hợp lệ.",
        )
    # This token was received directly over TLS from the configured Supabase
    # Auth endpoint. Decode claims only as an additional correctness assertion;
    # it is not accepting a browser-supplied JWT.
    try:
        claims = jwt.decode(
            access_token,
            options={"verify_signature": False, "verify_aud": False},
            algorithms=["HS256", "RS256"],
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase không trả về phiên AAL2 hợp lệ.",
        ) from exc
    if claims.get("sub") != expected_user_id or claims.get("aal") != "aal2":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google Authenticator chưa nâng phiên lên AAL2.",
        )


def _recovery_hash(code: str) -> str:
    return keyed_secret_hash(code.strip().upper(), purpose=_RECOVERY_HASH_PURPOSE)


async def generate_recovery_codes(
    db: AsyncSession,
    user_id: str,
    *,
    rotate: bool = False,
    commit: bool = True,
) -> list[str]:
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"recovery-codes:{user_id}"},
    )
    existing = await db.execute(
        select(AuthRecoveryCode.id).where(AuthRecoveryCode.user_id == user_id).limit(1)
    )
    if existing.first() is not None and not rotate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mã khôi phục đã được tạo và không thể hiển thị lại.",
        )
    if rotate:
        await db.execute(
            text("delete from auth_recovery_codes where user_id = cast(:uid as uuid)"),
            {"uid": user_id},
        )

    codes: list[str] = []
    for _ in range(_RECOVERY_CODE_COUNT):
        raw = base64.b32encode(secrets.token_bytes(10)).decode("ascii").rstrip("=")
        formatted = "-".join(raw[index : index + 4] for index in range(0, 16, 4))
        codes.append(formatted)
        db.add(
            AuthRecoveryCode(
                id=str(uuid4()),
                user_id=user_id,
                code_hash=_recovery_hash(formatted),
            )
        )
    if commit:
        await db.commit()
    else:
        await db.flush()
    return codes


async def use_recovery_code(
    db: AsyncSession,
    user_id: str,
    raw_code: str,
    *,
    commit: bool = True,
) -> None:
    result = await db.execute(
        text(
            "update auth_recovery_codes set used_at = now()"
            " where user_id = cast(:uid as uuid) and code_hash = :code_hash"
            " and used_at is null returning id"
        ),
        {"uid": user_id, "code_hash": _recovery_hash(raw_code)},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mã khôi phục không đúng hoặc đã được sử dụng.",
        )
    if commit:
        await db.commit()
    else:
        await db.flush()
