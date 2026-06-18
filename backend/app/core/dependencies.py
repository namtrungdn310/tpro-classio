from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_token
from app.models.user import Profile

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login") # chuẩn bảo mật OAuth2 với định dạng Bearer Token


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str | None]:
    payload = verify_token(token)
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không thể xác thực phiên đăng nhập",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none() # trả về đối tượng nếu tìm thấy hoặc None
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không tìm thấy hồ sơ người dùng",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": str(profile.id),
        "email": payload.get("email") if isinstance(payload.get("email"), str) else "",
        "role": profile.role,
        "full_name": profile.full_name,
    }


async def require_admin( # kỹ thuật Dependency Chaining bằng cách gọi Depends(get_current_user)
    current_user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, str | None]:
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền thực hiện thao tác này",
        )

    return current_user
