"""Users router: list users, update role/status/username (admin/owner only)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_owner
from app.models.google_identity import AuthGoogleIdentity
from app.models.totp_factor import AuthTotpFactor
from app.models.user_device_session import UserDeviceSession
from app.models.user import Profile
from app.routers.auth.common import (
    ensure_unique_username,
    is_owner_email,
    normalize_username,
    record_account_security_event,
)
from app.schemas.auth import (
    MessageResponse,
    UpdateUserRoleRequest,
    UpdateUserStatusRequest,
    UpdateUsernameRequest,
    UserAccount,
)
from app.services.auth_admin_service import get_active_auth_user, list_active_auth_users

router = APIRouter(tags=["auth"])
logger = logging.getLogger("tpro_classio.auth.users")


@router.get("/users", response_model=list[UserAccount])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> list[UserAccount]:
    auth_users = await list_active_auth_users()
    result = await db.execute(
        select(Profile).order_by(Profile.created_at.desc())
    )
    accounts: list[UserAccount] = []
    for profile in result.scalars().all():
        auth_user = auth_users.get(str(profile.id))
        if auth_user is None:
            continue
        accounts.append(
            UserAccount(
                id=str(profile.id),
                email=auth_user.email,
                role=profile.role or "viewer",
                account_status=profile.account_status or "pending",
                username=profile.username,
                full_name=profile.full_name,
                is_owner=is_owner_email(auth_user.email),
                created_at=profile.created_at.isoformat()
                if profile.created_at
                else None,
            )
        )
    return accounts


@router.patch("/users/{user_id}/role", response_model=UserAccount)
async def update_user_role(
    user_id: str,
    payload: UpdateUserRoleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> UserAccount:
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản không tìm thấy."
        )
    auth_user = await get_active_auth_user(user_id)
    if auth_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản không tìm thấy."
        )
    target_email = auth_user.email
    if is_owner_email(target_email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không thể thay đổi vai trò tài khoản Dev.",
        )

    actor_id = str(current_user["id"] or "")
    previous_role = profile.role
    if previous_role == payload.role:
        return UserAccount(
            id=profile.id,
            email=target_email,
            role=profile.role,
            account_status=profile.account_status,
            username=profile.username,
            full_name=profile.full_name,
            is_owner=False,
            created_at=profile.created_at.isoformat() if profile.created_at else None,
        )
    profile.role = payload.role
    await record_account_security_event(
        db,
        actor_user_id=actor_id,
        target_user_id=user_id,
        action="role_changed",
        previous_role=previous_role,
        next_role=payload.role,
    )
    await db.execute(
        delete(UserDeviceSession).where(UserDeviceSession.user_id == user_id)
    )
    await db.commit()
    await db.refresh(profile)

    return UserAccount(
        id=profile.id,
        email=target_email,
        role=profile.role,
        account_status=profile.account_status,
        username=profile.username,
        full_name=profile.full_name,
        is_owner=False,
        created_at=profile.created_at.isoformat() if profile.created_at else None,
    )


@router.patch("/users/{user_id}/status", response_model=UserAccount)
async def update_user_status(
    user_id: str,
    payload: UpdateUserStatusRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> UserAccount:
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản không tìm thấy."
        )
    auth_user = await get_active_auth_user(user_id)
    if auth_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản không tìm thấy."
        )
    target_email = auth_user.email
    if is_owner_email(target_email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không thể thay đổi trạng thái tài khoản Dev.",
        )

    actor_id = str(current_user["id"] or "")
    previous_status = profile.account_status
    if previous_status == payload.status:
        return UserAccount(
            id=profile.id,
            email=target_email,
            role=profile.role,
            account_status=profile.account_status,
            username=profile.username,
            full_name=profile.full_name,
            is_owner=False,
            created_at=profile.created_at.isoformat() if profile.created_at else None,
        )
    if previous_status == "pending" and payload.status == "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tài khoản phải hoàn tất Google và Google Authenticator để được kích hoạt.",
        )
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    profile.account_status = payload.status
    if payload.status == "active":
        factor = (
            await db.execute(
                select(AuthTotpFactor).where(AuthTotpFactor.user_id == user_id)
            )
        ).scalar_one_or_none()
        identity = (
            await db.execute(
                select(AuthGoogleIdentity).where(AuthGoogleIdentity.user_id == user_id)
            )
        ).scalar_one_or_none()
        if (
            profile.onboarding_completed_at is None
            or factor is None
            or factor.verified_at is None
            or identity is None
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tài khoản chưa hoàn tất xác thực bắt buộc.",
            )
        profile.approved_at = now
        profile.disabled_at = None
        profile.disabled_by = None
        action = "account_reactivated"
    elif payload.status == "disabled":
        profile.disabled_at = now
        profile.disabled_by = actor_id
        action = "account_disabled"
    else:
        action = "account_approved"

    await record_account_security_event(
        db,
        actor_user_id=actor_id,
        target_user_id=user_id,
        action=action,
        previous_status=previous_status,
        next_status=payload.status,
    )
    await db.execute(
        delete(UserDeviceSession).where(UserDeviceSession.user_id == user_id)
    )
    await db.commit()
    await db.refresh(profile)

    return UserAccount(
        id=profile.id,
        email=target_email,
        role=profile.role,
        account_status=profile.account_status,
        username=profile.username,
        full_name=profile.full_name,
        is_owner=False,
        created_at=profile.created_at.isoformat() if profile.created_at else None,
    )


@router.patch("/me/username", response_model=MessageResponse)
async def update_my_username(
    payload: UpdateUsernameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> MessageResponse:
    user_id = str(current_user["id"] or "")
    normalized = normalize_username(payload.username)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên người dùng không hợp lệ.",
        )
    unique_username = await ensure_unique_username(db, normalized, user_id)
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Hồ sơ không tìm thấy."
        )
    previous_username = profile.username
    profile.username = unique_username
    await record_account_security_event(
        db,
        actor_user_id=user_id,
        target_user_id=user_id,
        action="username_changed",
        previous_username=previous_username,
        next_username=unique_username,
    )
    await db.commit()
    return MessageResponse(
        message=f"Tên người dùng đã cập nhật thành '{unique_username}'."
    )
