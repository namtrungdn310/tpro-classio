"""R6-D14 — typed Principal + deny-by-default role dependencies.

Effective roles: `dev` (owner-derived from immutable OWNER_USER_ID, never
grantable), `admin`, `teacher`. `viewer` runtime is retired. A teacher must
have exactly one active staff link; missing/duplicate/inactive link fails
closed. All management routes use `require_management`; teacher self-routes
use `require_teacher_self`; owner-only operations use `require_dev`.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.device_sessions import hash_device_value, read_device_id
from app.core.security import verify_token
from app.models.staff_account_link import StaffAccountLink
from app.models.user import Profile
from app.models.user_device_session import UserDeviceSession

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)  # chuẩn bảo mật OAuth2 với định dạng Bearer Token


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str
    persistent_role: str
    effective_role: str
    is_owner: bool
    account_status: str
    staff_id: str | None
    aal: str
    device_type: str
    session_nonce: str
    username: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None

    @property
    def is_management(self) -> bool:
        return self.effective_role in ("dev", "admin")

    @property
    def is_dev(self) -> bool:
        return self.effective_role == "dev"

    @property
    def is_teacher(self) -> bool:
        return self.effective_role == "teacher"


async def resolve_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> Principal:
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
        # Fixed assurance-level claim, not a credential.
        or token_aal != "aal2"  # nosec B105
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
            StaffAccountLink.staff_id,
        )
        .join(Profile, Profile.id == UserDeviceSession.user_id)
        .outerjoin(
            StaffAccountLink,
            (StaffAccountLink.profile_id == UserDeviceSession.user_id)
            & (StaffAccountLink.lifecycle_status == "active"),
        )
        .where(
            UserDeviceSession.user_id == user_id,
            UserDeviceSession.device_type == device_type,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không thể xác thực phiên đăng nhập",
            headers={"WWW-Authenticate": "Bearer"},
        )
    session = row[0]
    current_role = row[1] or "unknown"
    account_status = row[2] or "pending"
    username = row[3]
    full_name = row[4]
    avatar_url = row[5]
    staff_id = str(row[6]) if row[6] is not None else None
    if (
        session is None
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

    # Effective role: dev = owner-derived (bất biến), teacher requires link.
    is_owner = _is_owner(user_id, email)
    if is_owner:
        effective_role = "dev"
    elif current_role == "teacher":
        if not settings.teacher_access_enabled or staff_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tài khoản giáo viên chưa được kích hoạt hoặc chưa liên kết nhân sự",
            )
        effective_role = "teacher"
    elif current_role == "admin":
        effective_role = "admin"
    else:
        # Legacy/unknown roles fail closed; runtime roles are admin/teacher.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản không có quyền truy cập hệ thống",
        )

    return Principal(
        user_id=user_id,
        email=email,
        persistent_role=current_role,
        effective_role=effective_role,
        is_owner=is_owner,
        account_status=account_status,
        staff_id=staff_id,
        aal="aal2",
        device_type=device_type,
        session_nonce=session_nonce,
        username=username,
        full_name=full_name,
        avatar_url=avatar_url,
    )


def _is_owner(user_id: str, email: str) -> bool:
    if settings.owner_user_id.strip():
        return user_id.strip().casefold() == settings.owner_user_id.strip().casefold()
    # Bootstrap/fallback: email cross-check chỉ cho local/test cũ.
    return email.strip().casefold() == settings.owner_admin_email.strip().casefold()


async def get_current_user(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    """Typed principal resolution."""
    return principal


async def require_management(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    if principal.effective_role not in {"dev", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền thực hiện thao tác này",
        )
    return principal


async def require_admin(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    if principal.effective_role not in {"dev", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền thực hiện thao tác này",
        )
    return principal


async def require_dev(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    if principal.effective_role != "dev":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản gốc được thực hiện thao tác này",
        )
    return principal


async def require_owner(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    if not principal.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản gốc được thực hiện thao tác này",
        )
    return principal


async def require_teacher_self(
    principal: Principal = Depends(resolve_principal),
) -> Principal:
    if principal.effective_role != "teacher" or principal.staff_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền thực hiện thao tác này",
        )
    return principal
