from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.device_sessions import hash_device_value, read_device_id
from app.core.security import verify_token
from app.models.user import Profile
from app.models.user_device_session import UserDeviceSession

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)  # chuẩn bảo mật OAuth2 với định dạng Bearer Token


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> dict[str, str | bool | None]:
    payload = verify_token(token)
    user_id = payload.get("sub")
    email = payload.get("email")
    role = payload.get("role")
    token_aal = payload.get("aal")
    device_type = payload.get("device_type")
    session_nonce = payload.get("session_nonce")
    if (
        not isinstance(user_id, str)
        or not user_id
        or not isinstance(email, str)
        or not isinstance(role, str)
        or not isinstance(device_type, str)
        or not isinstance(session_nonce, str)
        or token_aal != "aal2"
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không thể xác thực phiên đăng nhập",
            headers={"WWW-Authenticate": "Bearer"},
        )

    device_id = read_device_id(request)
    result = await db.execute(
        select(
            UserDeviceSession,
            Profile.role,
            Profile.account_status,
            Profile.username,
            Profile.full_name,
            Profile.avatar_url,
        )
        .join(Profile, Profile.id == UserDeviceSession.user_id)
        .where(
            UserDeviceSession.user_id == user_id,
            UserDeviceSession.device_type == device_type,
        )
    )
    row = result.one_or_none()
    session = row[0] if row is not None else None
    current_role = row[1] if row is not None else None
    account_status = row[2] if row is not None else None
    current_username = row[3] if row is not None else None
    current_full_name = row[4] if row is not None else None
    current_avatar_url = row[5] if row is not None else None
    if (
        session is None
        or not isinstance(current_role, str)
        or account_status != "active"
        or session.aal != "aal2"
        or session.mfa_verified_at is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Tài khoản không còn quyền truy cập hệ thống"
                if account_status in {"pending", "disabled"}
                else "Phiên đăng nhập đã bị thay thế trên thiết bị khác"
            ),
            headers={"WWW-Authenticate": "Bearer"},
        )
    absolute_cutoff = datetime.now(timezone.utc) - timedelta(
        days=settings.session_absolute_expire_days
    )
    if session.created_at < absolute_cutoff:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if (
        session.session_nonce != session_nonce
        or session.device_id_hash != hash_device_value(device_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập đã bị thay thế trên thiết bị khác",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": user_id,
        "email": email,
        "role": current_role,
        "username": current_username if isinstance(current_username, str) else None,
        "full_name": current_full_name if isinstance(current_full_name, str) else None,
        "avatar_url": current_avatar_url
        if isinstance(current_avatar_url, str)
        else None,
        # Owner authorization is derived from current server configuration,
        # not from a potentially stale claim in an already-issued token.
        "is_owner": email.strip().casefold()
        == settings.owner_admin_email.strip().casefold(),
        "device_type": device_type,
        "session_nonce": session_nonce,
        "aal": "aal2",
        "mfa_verified_at": session.mfa_verified_at,
    }


async def require_admin(  # kỹ thuật Dependency Chaining bằng cách gọi Depends(get_current_user)
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> dict[str, str | bool | None]:
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền thực hiện thao tác này",
        )

    return current_user


async def require_owner(
    current_user: dict[str, str | bool | None] = Depends(get_current_user),
) -> dict[str, str | bool | None]:
    if not current_user.get("is_owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản gốc được thực hiện thao tác này",
        )

    return current_user
