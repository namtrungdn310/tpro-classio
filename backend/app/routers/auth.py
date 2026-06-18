import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.security import create_access_token
from app.models.user import Profile
from app.schemas.auth import LoginRequest, TokenResponse, UserMe

router = APIRouter(tags=["auth"]) # gom các API thành nhóm "auth" trên Swagger UI


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Chưa cấu hình Supabase Auth",
        )

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token"
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            auth_url,
            params={"grant_type": "password"},
            headers={
                "apikey": settings.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={"email": payload.email, "password": payload.password},
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu không đúng",
        )

    auth_data = response.json()
    user = auth_data.get("user") or {}
    user_id = user.get("id")
    email = user.get("email") or payload.email
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu không đúng",
        )

    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản chưa được cấp quyền trong hệ thống",
        )

    access_token = create_access_token(
        {"sub": str(profile.id), "role": profile.role, "email": email}
    )
    return TokenResponse(access_token=access_token, role=profile.role)


@router.get("/me", response_model=UserMe)
async def me(current_user: dict[str, str | None] = Depends(get_current_user)) -> UserMe:
    return UserMe(
        id=current_user["id"] or "",
        email=current_user["email"] or "",
        role=current_user["role"] or "viewer",
        full_name=current_user.get("full_name"),
    )
