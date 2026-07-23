"""Server-side Google OIDC linking and authenticated avatar proxy."""

import hashlib
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.rate_limit import enforce_rate_limit
from app.models.google_identity import AuthGoogleIdentity
from app.routers.auth.common import record_account_security_event
from app.schemas.auth import GoogleAuthorizationResponse, MessageResponse
from app.services.auth_flow_service import (
    begin_google_oauth,
    claim_google_oauth,
    finish_google_oauth,
    validate_flow_session,
    validate_google_oauth_state,
)
from app.services.google_identity_service import (
    build_google_auth_url,
    exchange_google_code,
    link_google_identity,
    refresh_google_avatar,
)

router = APIRouter(tags=["auth"])


def _ensure_google_configured() -> None:
    placeholder_markers = ("<", ">", "replace", "google client secret")
    if not all(
        (
            settings.google_client_id,
            settings.google_client_secret,
            settings.google_redirect_uri,
        )
    ) or any(
        marker in settings.google_client_secret.casefold()
        for marker in placeholder_markers
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GOOGLE_CLIENT_SECRET chưa được cấu hình bằng secret thật từ Google Cloud.",
        )
    redirect = urlparse(settings.google_redirect_uri)
    frontend = urlparse(settings.frontend_url)
    if (
        redirect.scheme not in {"http", "https"}
        or redirect.scheme != frontend.scheme
        or redirect.netloc != frontend.netloc
        or redirect.path != "/auth/google/callback"
        or redirect.query
        or redirect.fragment
        or redirect.username is not None
        or redirect.password is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GOOGLE_REDIRECT_URI phải là callback cùng origin với FRONTEND_URL.",
        )


@router.post("/onboarding/google/start", response_model=GoogleAuthorizationResponse)
async def start_google_link(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> GoogleAuthorizationResponse:
    _ensure_google_configured()
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    state, nonce, verifier = await begin_google_oauth(db, flow)
    return GoogleAuthorizationResponse(
        authorization_url=build_google_auth_url(
            state,
            nonce,
            settings.google_redirect_uri,
            verifier,
        )
    )


@router.get("/onboarding/google/callback")
async def google_link_callback(
    request: Request,
    code: str = Query(min_length=1, max_length=4096),
    state_value: str = Query(alias="state", min_length=32, max_length=512),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    _ensure_google_configured()
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    expected_nonce, verifier = validate_google_oauth_state(flow, state_value)
    await claim_google_oauth(db, flow.id)
    claims, _, provider_refresh_token = await exchange_google_code(
        code=code,
        redirect_uri=settings.google_redirect_uri,
        code_verifier=verifier,
        expected_nonce=expected_nonce,
    )
    await link_google_identity(
        db,
        user_id=flow.user_id,
        verified_email=flow.email,
        claims=claims,
        provider_refresh_token=provider_refresh_token,
    )
    await record_account_security_event(
        db,
        actor_user_id=flow.user_id,
        target_user_id=flow.user_id,
        action="google_linked",
    )
    await db.commit()
    await finish_google_oauth(db, flow.id)
    target = urljoin(
        settings.frontend_url.rstrip("/") + "/", "onboarding/totp?google=linked"
    )
    return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/avatars/{user_id}")
async def get_private_avatar(
    user_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    requester_id = str(current_user.get("id") or "")
    if (
        requester_id != user_id
        and current_user.get("role") != "admin"
        and not current_user.get("is_owner")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không có quyền xem avatar này.",
        )
    result = await db.execute(
        select(AuthGoogleIdentity).where(AuthGoogleIdentity.user_id == user_id)
    )
    identity = result.scalar_one_or_none()
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Avatar không tồn tại."
        )
    if not identity.avatar_object_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tài khoản Google chưa có avatar; hệ thống sẽ dùng chữ cái đại diện.",
        )
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kho avatar chưa được cấu hình.",
        )
    storage_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/authenticated/"
        f"{settings.avatar_storage_bucket}/{identity.avatar_object_path}"
    )
    async with httpx.AsyncClient(timeout=10) as client:
        upstream = await client.get(
            storage_url,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
    if upstream.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Avatar không tồn tại."
        )
    etag = '"' + hashlib.sha256(upstream.content).hexdigest() + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)
    return Response(
        content=upstream.content,
        media_type="image/webp",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )


@router.post("/me/avatar/sync", response_model=MessageResponse)
async def sync_my_avatar(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    user_id = str(current_user.get("id") or "")
    await enforce_rate_limit(
        db,
        scope="avatar_sync",
        subject=user_id,
        max_attempts=3,
        window_seconds=15 * 60,
    )
    result = await db.execute(
        select(AuthGoogleIdentity).where(AuthGoogleIdentity.user_id == user_id)
    )
    identity = result.scalar_one_or_none()
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tài khoản chưa liên kết Google.",
        )
    if not await refresh_google_avatar(db, identity):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể đồng bộ avatar Google.",
        )
    return MessageResponse(message="Avatar Google đã được đồng bộ.")
