import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings


def _subject_hash(scope: str, subject: str) -> str:
    normalized = f"{scope}:{subject.strip().lower()}".encode("utf-8")
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        normalized,
        hashlib.sha256,
    ).hexdigest()


async def enforce_rate_limit(
    db: AsyncSession,
    *,
    scope: str,
    subject: str,
    max_attempts: int,
    window_seconds: int,
) -> None:
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    window_started_at = datetime.fromtimestamp(
        epoch - (epoch % window_seconds),
        tz=timezone.utc,
    )
    expires_at = window_started_at + timedelta(seconds=window_seconds * 2)

    await db.execute(text("delete from auth_rate_limits where expires_at <= now()"))
    result = await db.execute(
        text(
            """
            insert into auth_rate_limits (
                scope,
                subject_hash,
                window_started_at,
                attempt_count,
                expires_at
            ) values (
                :scope,
                :subject_hash,
                :window_started_at,
                1,
                :expires_at
            )
            on conflict (scope, subject_hash, window_started_at)
            do update set
                attempt_count = auth_rate_limits.attempt_count + 1,
                expires_at = excluded.expires_at
            returning attempt_count
            """
        ),
        {
            "scope": scope,
            "subject_hash": _subject_hash(scope, subject),
            "window_started_at": window_started_at,
            "expires_at": expires_at,
        },
    )
    attempts = int(result.scalar_one())
    await db.commit()

    if attempts > max_attempts:
        retry_after = max(
            1,
            int(
                (
                    window_started_at + timedelta(seconds=window_seconds) - now
                ).total_seconds()
            ),
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Có quá nhiều yêu cầu. Vui lòng thử lại sau.",
            headers={"Retry-After": str(retry_after)},
        )


async def clear_rate_limit(
    db: AsyncSession,
    *,
    scope: str,
    subject: str,
    commit: bool = True,
) -> None:
    await db.execute(
        text(
            """
            delete from auth_rate_limits
            where scope = :scope
              and subject_hash = :subject_hash
            """
        ),
        {
            "scope": scope,
            "subject_hash": _subject_hash(scope, subject),
        },
    )
    if commit:
        await db.commit()
