"""Google OIDC identity linking and hardened private-avatar pipeline."""

import asyncio
import base64
import hashlib
import hmac
import io
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse
from uuid import uuid4

import httpx
from fastapi import HTTPException, status
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import decrypt_credential, encrypt_credential
from app.core.config import settings
from app.models.google_identity import AuthGoogleIdentity

logger = logging.getLogger("tpro_classio.google_identity")

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_REFRESH_PURPOSE = "google-provider-refresh-token"
_ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
_ALLOWED_AVATAR_HOSTS = {
    "lh1.googleusercontent.com",
    "lh2.googleusercontent.com",
    "lh3.googleusercontent.com",
    "lh4.googleusercontent.com",
    "lh5.googleusercontent.com",
    "lh6.googleusercontent.com",
}


def build_google_auth_url(
    state: str, nonce: str, redirect_uri: str, code_verifier: str
) -> str:
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        # Consent is required on first link so avatar sync gets a refresh token.
        "prompt": "consent select_account",
    }
    return f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_google_code(
    *, code: str, redirect_uri: str, code_verifier: str, expected_nonce: str
) -> tuple[dict, str, str]:
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
                "grant_type": "authorization_code",
            },
        )
    if token_response.status_code >= 400:
        raise _google_error(_read_google_token_error_message(token_response))
    try:
        tokens = token_response.json()
    except ValueError as exc:
        raise _google_error("Google trả về dữ liệu xác thực không hợp lệ.") from exc
    if not isinstance(tokens, dict):
        raise _google_error("Google trả về dữ liệu xác thực không hợp lệ.")
    encoded_id_token = tokens.get("id_token")
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    if not all(
        isinstance(value, str) and value
        for value in (encoded_id_token, access_token, refresh_token)
    ):
        raise _google_error(
            "Google không cấp đủ quyền để đồng bộ avatar. Vui lòng cho phép lại."
        )

    try:
        claims = await asyncio.wait_for(
            asyncio.to_thread(
                google_id_token.verify_oauth2_token,
                encoded_id_token,
                GoogleAuthRequest(),
                settings.google_client_id,
                10,
            ),
            timeout=10,
        )
    except Exception as exc:
        raise _google_error("ID token Google không hợp lệ.") from exc
    nonce = claims.get("nonce")
    if not isinstance(nonce, str) or not hmac.compare_digest(nonce, expected_nonce):
        raise _google_error("Phiên Google không hợp lệ.")
    if claims.get("email_verified") is not True:
        raise _google_error("Email Google chưa được xác minh.")
    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise _google_error("Nhà phát hành Google không hợp lệ.")
    return claims, access_token, refresh_token


async def link_google_identity(
    db: AsyncSession,
    *,
    user_id: str,
    verified_email: str,
    claims: dict,
    provider_refresh_token: str,
) -> AuthGoogleIdentity:
    google_sub = claims.get("sub")
    google_email = claims.get("email")
    picture_url = claims.get("picture")
    if not all(
        isinstance(value, str) and value for value in (google_sub, google_email)
    ):
        raise _google_error("Danh tính Google không hợp lệ.")
    picture_url = (
        picture_url.strip()
        if isinstance(picture_url, str) and picture_url.strip()
        else None
    )
    normalized_google_email = google_email.strip().lower()
    if normalized_google_email != verified_email.strip().lower():
        raise _google_error(
            "Email Google không khớp với email đã xác minh. Vui lòng chọn đúng tài khoản."
        )

    result = await db.execute(
        select(AuthGoogleIdentity).where(AuthGoogleIdentity.google_sub == google_sub)
    )
    existing_by_sub = result.scalar_one_or_none()
    if existing_by_sub is not None and existing_by_sub.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản Google này đã liên kết với tài khoản khác.",
        )
    existing_user_result = await db.execute(
        select(AuthGoogleIdentity).where(AuthGoogleIdentity.user_id == user_id)
    )
    existing = existing_user_result.scalar_one_or_none()
    if existing is not None and existing.google_sub != google_sub:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản đã liên kết với một danh tính Google khác.",
        )

    now = datetime.now(timezone.utc)
    object_path: str | None = existing.avatar_object_path if existing else None
    avatar_url: str | None = None
    if picture_url:
        object_path, avatar_url = await fetch_and_store_avatar(picture_url, user_id)
    refresh_ciphertext = encrypt_credential(
        provider_refresh_token, purpose=_REFRESH_PURPOSE
    )
    if existing is None:
        existing = AuthGoogleIdentity(
            id=str(uuid4()),
            user_id=user_id,
            google_sub=google_sub,
            google_email=normalized_google_email,
            provider_refresh_token_ciphertext=refresh_ciphertext,
            avatar_object_path=object_path,
            avatar_source_url=picture_url,
            avatar_synced_at=now,
        )
        db.add(existing)
    else:
        existing.google_email = normalized_google_email
        existing.provider_refresh_token_ciphertext = refresh_ciphertext
        if picture_url:
            existing.avatar_object_path = object_path
            existing.avatar_source_url = picture_url
        existing.avatar_synced_at = now

    if avatar_url:
        await db.execute(
            text(
                "update profiles set avatar_url = :url, avatar_synced_at = :now"
                " where id = cast(:uid as uuid)"
            ),
            {"url": avatar_url, "now": now, "uid": user_id},
        )
    else:
        await db.execute(
            text(
                "update profiles set avatar_synced_at = :now"
                " where id = cast(:uid as uuid)"
            ),
            {"now": now, "uid": user_id},
        )
    await db.commit()
    await db.refresh(existing)
    return existing


async def fetch_and_store_avatar(picture_url: str, user_id: str) -> tuple[str, str]:
    parsed = urlparse(picture_url)
    hostname = (parsed.hostname or "").casefold()
    try:
        port = parsed.port
    except ValueError as exc:
        raise _google_error("URL avatar Google không hợp lệ.") from exc
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or hostname not in _ALLOWED_AVATAR_HOSTS
    ):
        raise _google_error("URL avatar Google không hợp lệ.")

    chunks: list[bytes] = []
    total = 0
    async with httpx.AsyncClient(follow_redirects=False, timeout=8) as client:
        async with client.stream("GET", picture_url) as response:
            if response.status_code != 200:
                raise _google_error("Không tải được avatar Google.")
            content_type = (
                response.headers.get("content-type", "")
                .split(";", 1)[0]
                .strip()
                .lower()
            )
            if content_type not in _ALLOWED_IMAGE_CONTENT_TYPES:
                raise _google_error("Định dạng avatar Google không được hỗ trợ.")
            declared_length = response.headers.get("content-length")
            if declared_length:
                try:
                    if int(declared_length) > settings.avatar_max_bytes:
                        raise _google_error(
                            "Avatar Google vượt quá dung lượng cho phép."
                        )
                except ValueError as exc:
                    raise _google_error("Phản hồi avatar Google không hợp lệ.") from exc
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > settings.avatar_max_bytes:
                    raise _google_error("Avatar Google vượt quá dung lượng cho phép.")
                chunks.append(chunk)
    raw_bytes = b"".join(chunks)

    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            if probe.format not in _ALLOWED_IMAGE_FORMATS:
                raise _google_error("Nội dung avatar Google không hợp lệ.")
            width, height = probe.size
            if width <= 0 or height <= 0 or width * height > 16_000_000:
                raise _google_error("Kích thước avatar Google không hợp lệ.")
            probe.verify()
        with Image.open(io.BytesIO(raw_bytes)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail(
                (settings.avatar_max_dimension, settings.avatar_max_dimension),
                Image.Resampling.LANCZOS,
            )
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=85, method=6)
            webp_bytes = output.getvalue()
    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise _google_error("Nội dung avatar Google không hợp lệ.") from exc

    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa cấu hình kho avatar riêng tư.",
        )
    object_path = f"users/{user_id}/avatar.webp"
    upload_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
        f"{settings.avatar_storage_bucket}/{object_path}"
    )
    async with httpx.AsyncClient(timeout=15) as client:
        upload = await client.put(
            upload_url,
            content=webp_bytes,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "image/webp",
                "x-upsert": "true",
                "Cache-Control": "3600",
            },
        )
    if upload.status_code not in (200, 201):
        logger.error("Private avatar upload failed with status %s", upload.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể lưu avatar Google.",
        )
    version = hashlib.sha256(webp_bytes).hexdigest()[:16]
    return object_path, f"/api/proxy/auth/avatars/{user_id}?v={version}"


async def _delete_private_avatar_object(object_path: str | None) -> None:
    """Best-effort removal after the database stops referencing an avatar.

    Supabase Storage file deletion uses its Storage API rather than direct SQL,
    so the object bytes and storage metadata are removed together. A failed
    cleanup is deliberately non-fatal: the profile is already cleared and the
    private orphan path is never exposed to the browser.
    """
    if not object_path or not settings.supabase_service_role_key:
        return
    delete_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
        f"{settings.avatar_storage_bucket}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(
                "DELETE",
                delete_url,
                headers={
                    "apikey": settings.supabase_service_role_key,
                    "Authorization": f"Bearer {settings.supabase_service_role_key}",
                    "Content-Type": "application/json",
                },
                json={"prefixes": [object_path]},
            )
    except httpx.HTTPError:
        logger.warning("Private avatar cleanup request failed")
        return
    if response.status_code not in (200, 204):
        logger.warning(
            "Private avatar cleanup failed with status %s", response.status_code
        )


async def refresh_google_avatar(
    db: AsyncSession,
    identity: AuthGoogleIdentity,
    *,
    only_if_due: bool = False,
) -> bool:
    """Refresh one avatar under a cross-process transaction advisory lock."""
    user_id = identity.user_id
    claimed = await db.execute(
        text("select pg_try_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"google-avatar-sync:{user_id}"},
    )
    if not bool(claimed.scalar_one()):
        await db.rollback()
        return False

    try:
        # Re-read after acquiring the lock. Another worker may have completed
        # while this request was waiting on its initial candidate query.
        await db.refresh(identity)
        cutoff = datetime.now(timezone.utc) - timedelta(
            hours=settings.avatar_sync_hours
        )
        if only_if_due and identity.avatar_synced_at >= cutoff:
            await db.rollback()
            return False

        refresh_token = decrypt_credential(
            identity.provider_refresh_token_ciphertext, purpose=_REFRESH_PURPOSE
        )
        async with httpx.AsyncClient(timeout=10) as client:
            token_response = await client.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            if token_response.status_code >= 400:
                await db.rollback()
                return False
            try:
                token_payload = token_response.json()
            except ValueError:
                await db.rollback()
                return False
            access_token = (
                token_payload.get("access_token")
                if isinstance(token_payload, dict)
                else None
            )
            if not isinstance(access_token, str):
                await db.rollback()
                return False
            info_response = await client.get(
                _GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if info_response.status_code >= 400:
            await db.rollback()
            return False
        try:
            info = info_response.json()
        except ValueError:
            await db.rollback()
            return False
        if not isinstance(info, dict):
            await db.rollback()
            return False
        if (
            info.get("sub") != identity.google_sub
            or str(info.get("email") or "").strip().lower() != identity.google_email
            or info.get("email_verified") is not True
        ):
            await db.rollback()
            return False
        picture_url = info.get("picture")
        if not isinstance(picture_url, str) or not picture_url.strip():
            old_object_path = identity.avatar_object_path
            now = datetime.now(timezone.utc)
            identity.avatar_object_path = None
            identity.avatar_source_url = None
            identity.avatar_synced_at = now
            await db.execute(
                text(
                    "update profiles set avatar_url = null, avatar_synced_at = :now"
                    " where id = cast(:uid as uuid)"
                ),
                {"now": now, "uid": user_id},
            )
            await db.commit()
            await _delete_private_avatar_object(old_object_path)
            return True
        picture_url = picture_url.strip()
        object_path, avatar_url = await fetch_and_store_avatar(picture_url, user_id)
        now = datetime.now(timezone.utc)
        identity.avatar_object_path = object_path
        identity.avatar_source_url = picture_url
        identity.avatar_synced_at = now
        await db.execute(
            text(
                "update profiles set avatar_url = :url, avatar_synced_at = :now"
                " where id = cast(:uid as uuid)"
            ),
            {"url": avatar_url, "now": now, "uid": user_id},
        )
        await db.commit()
        return True
    except Exception:
        await db.rollback()
        raise


async def sync_due_google_avatars(db: AsyncSession, *, limit: int = 20) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.avatar_sync_hours)
    result = await db.execute(
        select(AuthGoogleIdentity)
        .where(AuthGoogleIdentity.avatar_synced_at < cutoff)
        .order_by(AuthGoogleIdentity.avatar_synced_at.asc())
        .limit(limit)
    )
    identities = list(result.scalars())
    await db.commit()
    synced = 0
    for identity in identities:
        identity_id = identity.id
        try:
            synced += int(await refresh_google_avatar(db, identity, only_if_due=True))
        except Exception:
            logger.exception("Google avatar sync failed for identity %s", identity_id)
    return synced


def _google_error(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _read_google_token_error_message(response: httpx.Response) -> str:
    """Map Google token endpoint errors to actionable, non-secret messages."""
    error_code: str | None = None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        error_code = payload["error"]

    logger.warning(
        "Google OAuth token exchange failed with status %s and error %s",
        response.status_code,
        error_code or "unknown",
    )
    if error_code == "invalid_client":
        return "GOOGLE_CLIENT_SECRET chưa đúng hoặc chưa được cập nhật trong backend/.env."
    if error_code == "redirect_uri_mismatch":
        return "GOOGLE_REDIRECT_URI chưa khớp với Authorized redirect URI trong Google Cloud."
    if error_code == "invalid_grant":
        return "Mã xác thực Google đã hết hạn hoặc đã được sử dụng. Vui lòng liên kết lại."
    if error_code == "access_denied":
        return "Bạn đã huỷ quyền truy cập Google. Vui lòng cho phép lại để tiếp tục."
    return "Không thể xác minh tài khoản Google."
