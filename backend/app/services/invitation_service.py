"""Atomic, exact-email account invitation lifecycle."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.invitation import AccountInvitation
from app.services.auth_admin_service import get_active_auth_user_by_email


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_invitation(
    db: AsyncSession, *, email: str, invited_by: str
) -> tuple[str, AccountInvitation]:
    normalized_email = email.strip().lower()
    await db.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:email, 0))"),
        {"email": normalized_email},
    )
    if await get_active_auth_user_by_email(normalized_email) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email này đã có tài khoản trong hệ thống.",
        )

    # A new invite explicitly supersedes older, not-yet-started invites.
    await db.execute(
        text(
            "update account_invitations set revoked_at = now()"
            " where lower(email) = :email and registered_user_id is null"
            " and consumed_at is null and revoked_at is null"
        ),
        {"email": normalized_email},
    )

    raw_token = secrets.token_urlsafe(32)
    invitation = AccountInvitation(
        id=str(uuid4()),
        email=normalized_email,
        token_hash=_token_hash(raw_token),
        role="viewer",
        invited_by=invited_by,
        expires_at=datetime.now(timezone.utc)
        + timedelta(hours=settings.invitation_expire_hours),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    return raw_token, invitation


async def validate_invitation(
    db: AsyncSession, raw_token: str, claimed_email: str
) -> AccountInvitation:
    result = await db.execute(
        select(AccountInvitation)
        .where(AccountInvitation.token_hash == _token_hash(raw_token))
        .with_for_update()
    )
    invitation = result.scalar_one_or_none()
    if (
        invitation is None
        or invitation.consumed_at is not None
        or invitation.revoked_at is not None
        or invitation.expires_at <= datetime.now(timezone.utc)
        or invitation.email != claimed_email.strip().lower()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Liên kết mời không hợp lệ, đã hết hạn hoặc không khớp email.",
        )
    return invitation


async def bind_invitation_to_registration(
    db: AsyncSession,
    *,
    invitation_id: str,
    user_id: str,
    email: str,
) -> None:
    result = await db.execute(
        text(
            "update account_invitations set registered_user_id = cast(:uid as uuid),"
            " registration_started_at = coalesce(registration_started_at, now())"
            " where id = cast(:id as uuid) and lower(email) = lower(:email)"
            " and consumed_at is null and revoked_at is null and expires_at > now()"
            " and (registered_user_id is null or registered_user_id = cast(:uid as uuid))"
            " returning id"
        ),
        {"id": invitation_id, "uid": user_id, "email": email},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lời mời đã được dùng cho một đăng ký khác.",
        )
    await db.commit()


async def get_bound_invitation(
    db: AsyncSession, *, user_id: str, email: str
) -> AccountInvitation:
    result = await db.execute(
        select(AccountInvitation).where(
            AccountInvitation.registered_user_id == user_id,
            AccountInvitation.email == email.strip().lower(),
            AccountInvitation.consumed_at.is_(None),
            AccountInvitation.revoked_at.is_(None),
            AccountInvitation.expires_at > datetime.now(timezone.utc),
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Đăng ký không còn lời mời hợp lệ.",
        )
    return invitation


async def consume_invitation(
    db: AsyncSession, *, invitation_id: str, user_id: str, email: str
) -> None:
    """Atomically consume the exact invite bound at registration."""
    result = await db.execute(
        text(
            "update account_invitations set consumed_at = now()"
            " where id = cast(:id as uuid)"
            " and registered_user_id = cast(:uid as uuid)"
            " and lower(email) = lower(:email) and role = 'viewer'::user_role"
            " and consumed_at is null and revoked_at is null and expires_at > now()"
            " returning id"
        ),
        {"id": invitation_id, "uid": user_id, "email": email},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lời mời đã hết hạn, bị thu hồi hoặc đã được sử dụng.",
        )


async def revoke_invitation(db: AsyncSession, invitation_id: str) -> None:
    result = await db.execute(
        text(
            "update account_invitations set revoked_at = now()"
            " where id = cast(:id as uuid) and consumed_at is null"
            " and revoked_at is null returning id"
        ),
        {"id": invitation_id},
    )
    if result.first() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lời mời không tồn tại hoặc không còn hiệu lực.",
        )
    await db.commit()


async def list_invitations(
    db: AsyncSession, invited_by: str
) -> list[AccountInvitation]:
    result = await db.execute(
        select(AccountInvitation)
        .where(AccountInvitation.invited_by == invited_by)
        .order_by(AccountInvitation.created_at.desc())
        .limit(50)
    )
    return list(result.scalars().all())
