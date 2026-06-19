from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import verify_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login") # chuẩn bảo mật OAuth2 với định dạng Bearer Token


async def get_current_user(
    token: str = Depends(oauth2_scheme),
) -> dict[str, str | None]:
    payload = verify_token(token)
    user_id = payload.get("sub")
    email = payload.get("email")
    role = payload.get("role")
    full_name = payload.get("full_name")
    if (
        not isinstance(user_id, str)
        or not user_id
        or not isinstance(email, str)
        or not isinstance(role, str)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không thể xác thực phiên đăng nhập",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": user_id,
        "email": email,
        "role": role,
        "full_name": full_name if isinstance(full_name, str) else None,
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
