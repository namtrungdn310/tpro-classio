"""Session router: login (email+password → MFA required), refresh, logout, me."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.device_sessions import (
    classify_device_type,
    hash_device_value,
    read_device_id,
    read_request_user_agent,
    read_supabase_session_id,
)
from app.core.password_reset import (
    claim_password_reset_handle,
    create_password_reset_handle,
)
from app.core.rate_limit import clear_rate_limit, enforce_rate_limit
from app.models.google_identity import AuthGoogleIdentity
from app.models.totp_factor import AuthTotpFactor
from app.routers.auth.common import (
    ensure_supabase_auth_configured,
    get_or_create_profile,
    ensure_account_active,
    issue_internal_token,
    log_supabase_auth_failure,
    normalize_email,
    raise_auth_error,
    read_auth_session,
    read_supabase_access_token,
    read_supabase_error,
    read_user_metadata,
    revoke_supabase_access_token,
    revoke_supabase_session_by_refresh_token,
    revoke_temporary_supabase_session,
    supabase_auth_headers,
    supabase_post,
    supabase_put,
    upsert_device_session,
)
from app.schemas.auth import (
    AuthEmailRequest,
    CompletePasswordResetRequest,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    MfaRequiredResponse,
    OtpMessageResponse,
    PasswordResetOtpResponse,
    RefreshRequest,
    TokenResponse,
    UserMe,
    VerifyCurrentPasswordRequest,
    VerifyOtpRequest,
)
from app.models.user_device_session import UserDeviceSession as UDS
from app.services.auth_flow_service import (
    advance_flow_step,
    create_flow_session,
)
from app.services.invitation_service import get_bound_invitation
from app.services.mfa_service import (
    assert_aal2_auth_response,
    reset_incomplete_totp_enrollment,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger("tpro_classio.auth.session")

PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = settings.password_reset_token_expire_minutes
EMAIL_OTP_EXPIRE_SECONDS = settings.email_otp_expire_seconds


@router.post("/login", response_model=TokenResponse | MfaRequiredResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse | MfaRequiredResponse:
    """Password establishes only AAL1; every role must complete TOTP."""
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)
    await enforce_rate_limit(
        db, scope="login", subject=email, max_attempts=10, window_seconds=15 * 60
    )

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token"
    resp = await supabase_post(
        auth_url,
        params={"grant_type": "password"},
        headers=supabase_auth_headers(),
        json={"email": email, "password": payload.password},
    )
    if resp.status_code >= 400:
        detail = read_supabase_error(resp, "Email hoặc mật khẩu không đúng")
        log_supabase_auth_failure("password login", resp)
        raise_auth_error(detail)

    auth_data = resp.json()
    user_id, email, refresh_token = read_auth_session(auth_data, payload.email)
    full_name, avatar_url = read_user_metadata(auth_data)
    profile = await get_or_create_profile(db, user_id, email, full_name)
    if profile.account_status == "disabled":
        await revoke_temporary_supabase_session(
            auth_data, operation="rejected inactive account login"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ tài khoản Dev.",
        )

    await clear_rate_limit(db, scope="login", subject=email)

    supabase_access_token = read_supabase_access_token(auth_data)
    totp_factor = (
        await db.execute(
            select(AuthTotpFactor).where(AuthTotpFactor.user_id == user_id)
        )
    ).scalar_one_or_none()
    google_identity = (
        await db.execute(
            select(AuthGoogleIdentity).where(
                AuthGoogleIdentity.user_id == user_id,
                AuthGoogleIdentity.google_email == email,
            )
        )
    ).scalar_one_or_none()

    fully_onboarded = (
        profile.account_status == "active"
        and profile.onboarding_completed_at is not None
        and totp_factor is not None
        and totp_factor.verified_at is not None
        and google_identity is not None
    )
    if not fully_onboarded and totp_factor is not None:
        await reset_incomplete_totp_enrollment(
            db,
            user_id=user_id,
        )
        totp_factor = None
        # Admin factor deletion revokes every Supabase session for this user.
        # Establish a new AAL1 session before storing the onboarding flow; never
        # persist the now-revoked credentials returned by the first grant.
        resumed_response = await supabase_post(
            auth_url,
            params={"grant_type": "password"},
            headers=supabase_auth_headers(),
            json={"email": email, "password": payload.password},
        )
        if resumed_response.status_code >= 400:
            detail = read_supabase_error(
                resumed_response,
                "Không thể khôi phục thiết lập Google Authenticator.",
            )
            log_supabase_auth_failure(
                "interrupted MFA onboarding reset", resumed_response
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không thể tiếp tục thiết lập xác thực. Vui lòng thử lại.",
            )
        resumed_data = resumed_response.json()
        resumed_user_id, resumed_email, refresh_token = read_auth_session(
            resumed_data,
            email,
        )
        resumed_email = normalize_email(resumed_email)
        if resumed_user_id != user_id or resumed_email != email:
            await revoke_temporary_supabase_session(
                resumed_data,
                operation="rejected mismatched interrupted onboarding session",
            )
            raise_auth_error("Phiên khôi phục xác thực không hợp lệ")
        supabase_access_token = read_supabase_access_token(resumed_data)
    flow_type = "login_mfa" if fully_onboarded else "onboarding"
    invitation_id: str | None = None
    if not fully_onboarded and profile.account_status == "pending":
        invitation = await get_bound_invitation(db, user_id=user_id, email=email)
        invitation_id = str(invitation.id)

    flow_session_id = await create_flow_session(
        db,
        response,
        user_id=user_id,
        email=email,
        flow_type=flow_type,
        invitation_id=invitation_id,
        supabase_access_token=supabase_access_token,
        supabase_refresh_token=refresh_token,
    )
    if fully_onboarded:
        return MfaRequiredResponse(
            message="Vui lòng nhập mã Google Authenticator.",
            next_step="login_totp",
        )
    if google_identity is not None:
        await advance_flow_step(db, flow_session_id, "google_linked")
        return MfaRequiredResponse(
            message="Vui lòng hoàn tất Google Authenticator.",
            next_step="onboarding_totp",
        )
    return MfaRequiredResponse(
        message="Vui lòng liên kết tài khoản Google.",
        next_step="onboarding_google",
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    payload: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Refresh access token.  Only allowed if device session has aal=aal2."""
    ensure_supabase_auth_configured()
    device_type = classify_device_type(request.headers)
    device_id = read_device_id(request)

    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token"
    resp = await supabase_post(
        auth_url,
        params={"grant_type": "refresh_token"},
        headers=supabase_auth_headers(),
        json={"refresh_token": payload.refresh_token},
    )
    if resp.status_code >= 400:
        detail = read_supabase_error(resp, "Phiên đăng nhập đã hết hạn")
        log_supabase_auth_failure("refresh token", resp)
        raise_auth_error(detail)

    auth_data = resp.json()
    user_id, email, refresh_token = read_auth_session(auth_data, "")
    supabase_access_token = read_supabase_access_token(auth_data)
    supabase_session_id = read_supabase_session_id(supabase_access_token)
    if not supabase_session_id:
        raise_auth_error("Phiên đăng nhập không có định danh hợp lệ")

    full_name, avatar_url = read_user_metadata(auth_data)
    profile = await get_or_create_profile(db, user_id, email, full_name)
    try:
        ensure_account_active(profile, email)
    except HTTPException:
        await revoke_temporary_supabase_session(
            auth_data, operation="rejected inactive account refresh"
        )
        raise

    from datetime import timedelta as td

    absolute_cutoff = datetime.now(timezone.utc) - td(
        days=max(1, settings.session_absolute_expire_days)
    )
    result = await db.execute(
        select(UDS).where(
            UDS.user_id == user_id,
            UDS.device_type == device_type,
            UDS.device_id_hash == hash_device_value(device_id),
            UDS.supabase_session_id == supabase_session_id,
        )
    )
    active_session = result.scalar_one_or_none()
    if active_session is None:
        await revoke_temporary_supabase_session(
            auth_data, operation="rejected replaced app session"
        )
        raise_auth_error("Phiên đăng nhập đã bị thay thế trên thiết bị khác")
    if active_session.created_at < absolute_cutoff:
        await revoke_temporary_supabase_session(
            auth_data, operation="rejected expired app session"
        )
        raise_auth_error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    # Refresh must NOT upgrade AAL — preserve existing aal
    existing_aal = active_session.aal or "aal1"
    if existing_aal != "aal2" or active_session.mfa_verified_at is None:
        await revoke_temporary_supabase_session(
            auth_data, operation="rejected non-aal2 refresh"
        )
        raise_auth_error("Phiên yêu cầu xác thực lại Google Authenticator")
    if active_session.mfa_factor_id != "recovery-code":
        assert_aal2_auth_response(auth_data, expected_user_id=user_id)

    session_context = await upsert_device_session(
        db,
        user_id=user_id,
        device_type=device_type,
        device_id=device_id,
        refresh_token=refresh_token,
        supabase_access_token=supabase_access_token,
        user_agent=read_request_user_agent(request),
        rotate_nonce=False,
        existing_nonce=active_session.session_nonce,
        aal=existing_aal,
        mfa_factor_id=active_session.mfa_factor_id,
        mfa_verified_at=active_session.mfa_verified_at,
    )
    return await issue_internal_token(
        db,
        user_id,
        email,
        refresh_token,
        session_context,
        full_name,
        avatar_url,
        profile,
    )


@router.get("/me", response_model=UserMe)
async def me(current_user: dict = Depends(get_current_user)) -> UserMe:
    return UserMe(
        id=str(current_user["id"] or ""),
        email=str(current_user["email"] or ""),
        role=str(current_user["role"] or "viewer"),
        username=current_user.get("username")
        if isinstance(current_user.get("username"), str)
        else None,
        full_name=current_user.get("full_name")
        if isinstance(current_user.get("full_name"), str)
        else None,
        avatar_url=current_user.get("avatar_url")
        if isinstance(current_user.get("avatar_url"), str)
        else None,
        is_owner=bool(current_user.get("is_owner")),
    )


@router.post("/logout")
async def logout(
    payload: LogoutRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    session_nonce = current_user.get("session_nonce")
    device_type = current_user.get("device_type")
    if not isinstance(session_nonce, str) or not isinstance(device_type, str):
        raise_auth_error("Phiên đăng nhập không hợp lệ")
    await db.execute(
        delete(UDS).where(
            UDS.user_id == str(current_user["id"] or ""),
            UDS.device_type == device_type,
            UDS.session_nonce == session_nonce,
        )
    )
    await db.commit()
    refresh_token = payload.refresh_token if payload is not None else None
    if refresh_token:
        # Local invalidation above is authoritative for this app. Even during a
        # temporary Supabase outage, a stolen refresh token cannot pass the
        # missing local device-session binding on /auth/refresh.
        await revoke_supabase_session_by_refresh_token(
            refresh_token,
            operation="user logout",
        )
    return {"message": "Đã đăng xuất"}


# ---- Password reset (unchanged from original) ----


@router.post("/password/reset/start", response_model=OtpMessageResponse)
async def start_password_reset(
    payload: AuthEmailRequest, db: AsyncSession = Depends(get_db)
) -> OtpMessageResponse:
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)
    await enforce_rate_limit(
        db,
        scope="password_reset_start",
        subject=email,
        max_attempts=5,
        window_seconds=15 * 60,
    )
    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/recover"
    resp = await supabase_post(
        auth_url, headers=supabase_auth_headers(), json={"email": email}
    )
    if resp.status_code >= 400:
        log_supabase_auth_failure("password recovery", resp)
        if resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Có quá nhiều yêu cầu. Vui lòng thử lại sau.",
            )
        if resp.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Dịch vụ gửi email tạm thời không khả dụng",
            )
    return OtpMessageResponse(
        message="Đã gửi mã OTP đặt lại mật khẩu",
        otp_expires_in_seconds=EMAIL_OTP_EXPIRE_SECONDS,
    )


@router.post("/password/reset/verify-otp", response_model=PasswordResetOtpResponse)
async def verify_password_reset_otp(
    payload: VerifyOtpRequest, db: AsyncSession = Depends(get_db)
) -> PasswordResetOtpResponse:
    ensure_supabase_auth_configured()
    email = normalize_email(payload.email)
    await enforce_rate_limit(
        db,
        scope="password_reset_verify",
        subject=email,
        max_attempts=8,
        window_seconds=10 * 60,
    )
    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/verify"
    verify_response = await supabase_post(
        auth_url,
        headers=supabase_auth_headers(),
        json={"email": email, "token": payload.otp.strip(), "type": "recovery"},
    )
    if verify_response.status_code >= 400:
        detail = read_supabase_error(
            verify_response, "Mã OTP không đúng hoặc đã hết hạn"
        )
        log_supabase_auth_failure("password recovery OTP verify", verify_response)
        raise_auth_error(detail)
    await clear_rate_limit(db, scope="password_reset_verify", subject=email)
    auth_data_pw = verify_response.json()
    user_id, _, _ = read_auth_session(auth_data_pw, email)
    supabase_access_token = read_supabase_access_token(auth_data_pw)
    reset_token = await create_password_reset_handle(
        db,
        user_id=user_id,
        email=email,
        supabase_access_token=supabase_access_token,
        expires_in_minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES,
    )
    return PasswordResetOtpResponse(
        reset_token=reset_token,
        reset_token_expires_in_seconds=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/password/reset/complete", response_model=MessageResponse)
async def complete_password_reset(
    payload: CompletePasswordResetRequest, db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    ensure_supabase_auth_configured()
    user_id, _, supabase_access_token = await claim_password_reset_handle(
        db, payload.reset_token
    )
    user_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    update_response = await supabase_put(
        user_url,
        headers=supabase_auth_headers(supabase_access_token),
        json={"password": payload.new_password},
    )
    if update_response.status_code >= 400:
        detail = read_supabase_error(update_response, "Không thể cập nhật mật khẩu mới")
        log_supabase_auth_failure("password update", update_response)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    await db.execute(delete(UDS).where(UDS.user_id == user_id))
    await db.commit()
    # Password reset is an account-wide security boundary. Supabase password
    # update is already complete, so local sessions stay revoked even if the
    # upstream global sign-out is temporarily unavailable.
    await revoke_supabase_access_token(
        supabase_access_token,
        scope="global",
        operation="password reset global logout",
    )
    return MessageResponse(message="Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại.")


@router.post("/me/password/verify", response_model=MessageResponse)
async def verify_current_password(
    payload: VerifyCurrentPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> MessageResponse:
    ensure_supabase_auth_configured()
    user_id = str(current_user["id"] or "")
    email = normalize_email(str(current_user["email"] or ""))
    await enforce_rate_limit(
        db,
        scope="current_password_verify",
        subject=user_id,
        max_attempts=5,
        window_seconds=15 * 60,
    )
    auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token"
    resp = await supabase_post(
        auth_url,
        params={"grant_type": "password"},
        headers=supabase_auth_headers(),
        json={"email": email, "password": payload.password},
    )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu hiện tại không chính xác.",
        )
    auth_data = resp.json()
    verified_user_id, _, _ = read_auth_session(auth_data, email)
    if verified_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể xác minh mật khẩu hiện tại.",
        )
    if not await revoke_temporary_supabase_session(
        auth_data, operation="current password verification cleanup"
    ):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể hoàn tất xác minh mật khẩu. Vui lòng thử lại.",
        )
    await clear_rate_limit(db, scope="current_password_verify", subject=user_id)
    return MessageResponse(message="Mật khẩu hiện tại đã được xác minh.")
