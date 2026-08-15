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
from app.models.staff import StaffMember
from app.models.staff_account_link import StaffAccountLink, StaffAccountLinkEvent
from app.services.auth_admin_service import get_active_auth_user_by_email


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_invitation(
    db: AsyncSession,
    *,
    email: str,
    invited_by: str,
    role: str = "teacher",
    staff_id: str | None = None,
) -> tuple[str, AccountInvitation]:
    if role not in ("admin", "teacher"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vai trò lời mời phải là 'admin' hoặc 'teacher'.",
        )

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

    if role == "teacher":
        if not staff_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lời mời tài khoản giáo viên bắt buộc phải chọn nhân sự.",
            )
        await db.execute(
            text("select pg_advisory_xact_lock(hashtextextended(:staff_id, 0))"),
            {"staff_id": str(staff_id)},
        )
        # Expired reservations remain rows for audit, but must no longer block
        # the stable partial unique index used by a new invitation.
        await db.execute(
            text(
                "update account_invitations set revoked_at = now()"
                " where staff_id = cast(:staff_id as uuid) and role = 'teacher'"
                " and consumed_at is null and revoked_at is null"
                " and expires_at <= now()"
            ),
            {"staff_id": str(staff_id)},
        )
        staff = await db.get(StaffMember, staff_id)
        if staff is None or not staff.is_active or staff.staff_type != "TEACHER":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Nhân sự giáo viên không hợp lệ hoặc đã ngừng hoạt động.",
            )
        # Check if staff is already linked
        existing_link = await db.scalar(
            select(StaffAccountLink).where(
                StaffAccountLink.staff_id == staff_id,
                StaffAccountLink.lifecycle_status == "active",
            )
        )
        if existing_link is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nhân sự này đã được liên kết với một tài khoản khác.",
            )
        # Check if staff is already reserved by an active invitation
        active_reserved = await db.scalar(
            select(AccountInvitation).where(
                AccountInvitation.staff_id == staff_id,
                AccountInvitation.role == "teacher",
                AccountInvitation.consumed_at.is_(None),
                AccountInvitation.revoked_at.is_(None),
                AccountInvitation.expires_at > datetime.now(timezone.utc),
            )
        )
        if active_reserved is not None and active_reserved.email != normalized_email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nhân sự này đang được giữ chỗ bởi một lời mời khác.",
            )
    else:
        staff_id = None

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
        role=role,
        staff_id=staff_id,
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
            " registration_started_at = coalesce(registration_started_at, now()),"
            " expires_at = greatest("
            "   expires_at,"
            "   now() + make_interval(mins => :onboarding_minutes)"
            " )"
            " where id = cast(:id as uuid) and lower(email) = lower(:email)"
            " and consumed_at is null and revoked_at is null and expires_at > now()"
            " and (registered_user_id is null or registered_user_id = cast(:uid as uuid))"
            " returning id"
        ),
        {
            "id": invitation_id,
            "uid": user_id,
            "email": email,
            "onboarding_minutes": settings.onboarding_session_minutes,
        },
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
) -> AccountInvitation:
    """Atomically consume the exact invite bound at registration, linking staff if teacher."""
    result = await db.execute(
        select(AccountInvitation)
        .where(
            AccountInvitation.id == invitation_id,
            AccountInvitation.registered_user_id == user_id,
            AccountInvitation.email == email.strip().lower(),
            AccountInvitation.consumed_at.is_(None),
            AccountInvitation.revoked_at.is_(None),
            AccountInvitation.expires_at > datetime.now(timezone.utc),
        )
        .with_for_update()
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lời mời đã hết hạn, bị thu hồi hoặc đã được sử dụng.",
        )

    invitation.consumed_at = datetime.now(timezone.utc)

    if invitation.role == "teacher":
        if not invitation.staff_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Lời mời giáo viên không hợp lệ (thiếu thông tin nhân sự).",
            )
        staff = (
            await db.execute(
                select(StaffMember)
                .where(StaffMember.id == invitation.staff_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if staff is None or not staff.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nhân sự được liên kết không còn hoạt động.",
            )
        # Check link does not already exist
        existing_link = await db.scalar(
            select(StaffAccountLink).where(
                StaffAccountLink.staff_id == invitation.staff_id,
                StaffAccountLink.lifecycle_status == "active",
            )
        )
        if existing_link is not None and existing_link.profile_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nhân sự này đã được liên kết với một tài khoản khác.",
            )
        if existing_link is None:
            link = StaffAccountLink(
                profile_id=user_id,
                staff_id=invitation.staff_id,
                lifecycle_status="active",
            )
            db.add(link)
            await db.flush()
            event = StaffAccountLinkEvent(
                link_id=link.id,
                profile_id=user_id,
                staff_id=invitation.staff_id,
                event_type="LINK",
                lifecycle_status="active",
                actor_user_id=user_id,
                reason="teacher_onboarding_completed",
            )
            db.add(event)

    return invitation


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
