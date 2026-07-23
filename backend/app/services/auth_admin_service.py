"""Minimal Supabase Auth admin reads used by the trusted backend only.

The application database role intentionally has no direct privileges on the
`auth` schema. These helpers read the small amount of identity metadata the app
needs through Supabase's server-side Admin API with the service-role key.
"""

from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.http import supabase_auth_client


@dataclass(frozen=True)
class AuthAdminUser:
    id: str
    email: str
    email_confirmed: bool
    deleted: bool = False


def _admin_headers() -> dict[str, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa cấu hình quyền quản trị Supabase Auth.",
        )
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _parse_admin_user(payload: object) -> AuthAdminUser | None:
    if not isinstance(payload, dict):
        return None
    user_id = payload.get("id")
    email = payload.get("email")
    if not isinstance(user_id, str) or not user_id or not isinstance(email, str):
        return None
    return AuthAdminUser(
        id=user_id,
        email=email.strip().lower(),
        email_confirmed=bool(
            payload.get("email_confirmed_at") or payload.get("confirmed_at")
        ),
        deleted=bool(payload.get("deleted_at")),
    )


async def list_active_auth_users(*, per_page: int = 1000) -> dict[str, AuthAdminUser]:
    users: dict[str, AuthAdminUser] = {}
    page = 1
    while True:
        try:
            response = await supabase_auth_client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
                headers=_admin_headers(),
                params={"page": page, "per_page": per_page},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không đọc được danh sách tài khoản từ Supabase Auth.",
            ) from exc
        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Supabase Auth từ chối đọc danh sách tài khoản.",
            )
        payload = response.json()
        raw_users = payload.get("users") if isinstance(payload, dict) else None
        if not isinstance(raw_users, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Supabase Auth trả về danh sách tài khoản không hợp lệ.",
            )
        for raw_user in raw_users:
            user = _parse_admin_user(raw_user)
            if user is not None and not user.deleted:
                users[user.id] = user
        if len(raw_users) < per_page:
            break
        page += 1
    return users


async def get_active_auth_user(user_id: str) -> AuthAdminUser | None:
    try:
        response = await supabase_auth_client.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
            headers=_admin_headers(),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không đọc được tài khoản từ Supabase Auth.",
        ) from exc
    if response.status_code == status.HTTP_404_NOT_FOUND:
        return None
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase Auth từ chối đọc tài khoản.",
        )
    user = _parse_admin_user(response.json())
    return user if user is not None and not user.deleted else None


async def get_active_auth_user_by_email(email: str) -> AuthAdminUser | None:
    normalized_email = email.strip().lower()
    users = await list_active_auth_users()
    return next(
        (user for user in users.values() if user.email == normalized_email),
        None,
    )
