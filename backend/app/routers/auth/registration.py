"""Registration router: invite-only, OTP email verification → pre-auth flow session."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import clear_rate_limit, enforce_rate_limit
from app.routers.auth.common import (
    ensure_supabase_auth_configured,
    get_active_auth_user_id_by_email,
    get_or_create_profile,
    is_auth_email_confirmed,
    lock_registration_email,
    log_supabase_auth_failure,
    normalize_email,
    raise_auth_error,
    read_auth_session,
    read_supabase_access_token,
    read_supabase_error,
    read_user_metadata,
    supabase_auth_headers,
    supabase_post,
)
from app.schemas.auth import (
    AuthEmailRequest,
    MessageResponse,
    OtpMessageResponse,
    RegisterRequest,
    VerifyOtpRequest,
)
from app.services.auth_flow_service import create_flow_session
from app.services.invitation_service import (
    bind_invitation_to_registration,
    get_bound_invitation,
    validate_invitation,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger("tpro_classio.auth.registration")

EMAIL_OTP_EXPIRE_SECONDS = settings.email_otp_expire_seconds


@router.post("/register", response_model=OtpMessageResponse)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> OtpMessageResponse:
    """Step 1: Validate invitation + register email/password with Supabase → send OTP."""
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)

    await enforce_rate_limit(
        db, scope="register", subject=email, max_attempts=5, window_seconds=15 * 60
    )

    # Validate invitation token
    invitation = await validate_invitation(db, payload.invitation_token, email)

    await lock_registration_email(db, email)
    if await get_active_auth_user_id_by_email(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email này đã được đăng ký. Vui lòng đăng nhập hoặc sử dụng tính năng quên mật khẩu.",
        )

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/signup"
    response = await supabase_post(
        auth_url,
        headers=supabase_auth_headers(),
        json={
            "email": email,
            "password": payload.password,
            "data": {"username": payload.username},
        },
    )

    if response.status_code >= 400:
        detail = read_supabase_error(response, "Không thể đăng ký email này")
        log_supabase_auth_failure("signup", response)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    auth_data = response.json()
    user = auth_data.get("user") or {}
    user_id = user.get("id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email này đã được đăng ký.",
        )

    persisted_user_id = await get_active_auth_user_id_by_email(db, email)
    if persisted_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email này đã được đăng ký."
        )

    await bind_invitation_to_registration(
        db,
        invitation_id=str(invitation.id),
        user_id=user_id,
        email=email,
    )

    return OtpMessageResponse(
        message="Đã gửi email xác thực tài khoản",
        otp_expires_in_seconds=EMAIL_OTP_EXPIRE_SECONDS,
    )


@router.post("/register/resend", response_model=OtpMessageResponse)
async def resend_register_otp(
    payload: AuthEmailRequest,
    db: AsyncSession = Depends(get_db),
) -> OtpMessageResponse:
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)
    await enforce_rate_limit(
        db,
        scope="register_resend",
        subject=email,
        max_attempts=3,
        window_seconds=10 * 60,
    )

    active_user_id = await get_active_auth_user_id_by_email(db, email)
    if not active_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Đăng ký không còn hiệu lực.",
        )
    await get_bound_invitation(db, user_id=active_user_id, email=email)

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/resend"
    response = await supabase_post(
        auth_url,
        headers=supabase_auth_headers(),
        json={"email": email, "type": "signup"},
    )
    if response.status_code >= 400:
        detail = read_supabase_error(response, "Không thể gửi lại mã OTP đăng ký")
        log_supabase_auth_failure("signup resend", response)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    return OtpMessageResponse(
        message="Đã gửi lại mã OTP đăng ký",
        otp_expires_in_seconds=EMAIL_OTP_EXPIRE_SECONDS,
    )


@router.post("/register/verify", response_model=MessageResponse)
async def verify_register_otp(
    payload: VerifyOtpRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Verify the one-time email OTP, then continue to Google identity linking."""
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)
    await enforce_rate_limit(
        db,
        scope="register_verify",
        subject=email,
        max_attempts=8,
        window_seconds=10 * 60,
    )

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/verify"
    resp = await supabase_post(
        auth_url,
        headers=supabase_auth_headers(),
        json={"email": email, "token": payload.otp.strip(), "type": "signup"},
    )

    if resp.status_code >= 400:
        detail = read_supabase_error(resp, "Mã OTP đăng ký không đúng hoặc đã hết hạn")
        log_supabase_auth_failure("signup OTP verify", resp)
        if await is_auth_email_confirmed(db, email):
            await clear_rate_limit(db, scope="register_verify", subject=email)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email đã được xác thực. Vui lòng tiếp tục thiết lập xác thực hai bước.",
            )
        raise_auth_error(detail)

    auth_data = resp.json()
    await clear_rate_limit(db, scope="register_verify", subject=email)
    user_id, email, refresh_token = read_auth_session(auth_data, payload.email)
    supabase_access_token = read_supabase_access_token(auth_data)
    full_name, _ = read_user_metadata(auth_data)

    invitation = await get_bound_invitation(db, user_id=user_id, email=email)

    # This endpoint is invitation-only. Activation happens atomically only
    # after Google identity, TOTP and recovery-code confirmation complete.
    await get_or_create_profile(db, user_id, email, full_name)

    await create_flow_session(
        db,
        response,
        user_id=user_id,
        email=email,
        flow_type="onboarding",
        invitation_id=str(invitation.id),
        supabase_access_token=supabase_access_token,
        supabase_refresh_token=refresh_token,
    )

    return MessageResponse(
        message="Email đã xác thực. Vui lòng liên kết đúng tài khoản Google."
    )
