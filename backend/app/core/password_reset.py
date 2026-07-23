import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_credentials import decrypt_credential, encrypt_credential

_RESET_ACCESS_TOKEN_PURPOSE = "password-reset-access-token-v1"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_password_reset_handle(
    db: AsyncSession,
    *,
    user_id: str,
    email: str,
    supabase_access_token: str,
    expires_in_minutes: int,
) -> str:
    handle = secrets.token_urlsafe(32)
    ciphertext = encrypt_credential(
        supabase_access_token,
        purpose=_RESET_ACCESS_TOKEN_PURPOSE,
    )
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes)

    await db.execute(
        text(
            """
            delete from password_reset_sessions
            where user_id = cast(:user_id as uuid)
               or expires_at <= now()
               or used_at is not null
            """
        ),
        {"user_id": user_id},
    )
    await db.execute(
        text(
            """
            insert into password_reset_sessions (
                token_hash,
                user_id,
                email,
                access_token_ciphertext,
                expires_at
            ) values (
                :token_hash,
                cast(:user_id as uuid),
                :email,
                :ciphertext,
                :expires_at
            )
            """
        ),
        {
            "token_hash": _token_hash(handle),
            "user_id": user_id,
            "email": email,
            "ciphertext": ciphertext,
            "expires_at": expires_at,
        },
    )
    await db.commit()
    return handle


async def claim_password_reset_handle(
    db: AsyncSession,
    handle: str,
) -> tuple[str, str, str]:
    result = await db.execute(
        text(
            """
            update password_reset_sessions
            set used_at = now()
            where token_hash = :token_hash
              and used_at is null
              and expires_at > now()
            returning user_id::text, email, access_token_ciphertext
            """
        ),
        {"token_hash": _token_hash(handle)},
    )
    row = result.first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
        )

    access_token = decrypt_credential(
        str(row._mapping["access_token_ciphertext"]),
        purpose=_RESET_ACCESS_TOKEN_PURPOSE,
    )

    return (
        str(row._mapping["user_id"]),
        str(row._mapping["email"]),
        access_token,
    )
