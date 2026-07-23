"""Supabase-native TOTP enrollment, login challenge and recovery delivery."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.device_sessions import (
    classify_device_type,
    read_device_id,
    read_request_user_agent,
)
from app.core.rate_limit import clear_rate_limit, enforce_rate_limit
from app.models.google_identity import AuthGoogleIdentity
from app.models.totp_factor import AuthTotpFactor
from app.models.user import Profile
from app.models.user_device_session import UserDeviceSession
from app.routers.auth.common import (
    issue_internal_token,
    record_account_security_event,
    revoke_supabase_access_token,
    upsert_device_session,
)
from app.schemas.auth import (
    MessageResponse,
    RecoveryCodeLoginRequest,
    TokenResponse,
    TotpEnrollResponse,
    TotpVerifyRequest,
)
from app.services.auth_flow_service import (
    consume_flow_session,
    delete_flow_session,
    mark_onboarding_recovery_codes_confirmed,
    read_upstream_credentials,
    take_onboarding_recovery_codes,
    upgrade_onboarding_after_totp,
    validate_flow_session,
)
from app.services.invitation_service import consume_invitation
from app.services.mfa_service import (
    enroll_totp,
    generate_recovery_codes,
    use_recovery_code,
    verify_totp_code,
)

router = APIRouter(tags=["auth"])


@router.post("/onboarding/totp/enroll", response_model=TotpEnrollResponse)
async def onboarding_totp_enroll(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TotpEnrollResponse:
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    google_identity = await db.execute(
        select(AuthGoogleIdentity).where(
            AuthGoogleIdentity.user_id == flow.user_id,
            AuthGoogleIdentity.google_email == flow.email,
        )
    )
    if (
        google_identity.scalar_one_or_none() is None
        or "google_linked" not in flow.completed_steps
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vui lòng liên kết đúng tài khoản Google trước.",
        )
    # Creating a native factor performs provider-side writes and generates a
    # fresh secret/QR. Bound it independently from code verification so a
    # valid onboarding cookie cannot churn factors indefinitely.
    await enforce_rate_limit(
        db,
        scope="totp_enroll",
        subject=flow.user_id,
        max_attempts=3,
        window_seconds=15 * 60,
    )
    access_token, _ = read_upstream_credentials(flow)
    result = await enroll_totp(
        db,
        user_id=flow.user_id,
        user_email=flow.email,
        supabase_access_token=access_token,
    )
    return TotpEnrollResponse(**result)


@router.post("/onboarding/totp/verify", response_model=MessageResponse)
async def onboarding_totp_verify(
    payload: TotpVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Verify TOTP but do not activate or issue an app session yet.

    Recovery codes must be displayed and confirmed first.
    """
    flow = await validate_flow_session(request, db, required_flow_type="onboarding")
    if flow.aal != "aal1":
        return MessageResponse(
            message="Google Authenticator đã được xác minh. Vui lòng lưu mã khôi phục."
        )
    await enforce_rate_limit(
        db,
        scope="totp_verify",
        subject=flow.user_id,
        max_attempts=5,
        window_seconds=5 * 60,
    )
    access_token, _ = read_upstream_credentials(flow)
    factor, auth_data = await verify_totp_code(
        db,
        user_id=flow.user_id,
        code=payload.code.strip(),
        supabase_access_token=access_token,
    )
    aal2_access = auth_data.get("access_token")
    aal2_refresh = auth_data.get("refresh_token")
    if not isinstance(aal2_access, str) or not isinstance(aal2_refresh, str):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase không trả về phiên AAL2 hợp lệ.",
        )
    factor.verified_at = datetime.now(timezone.utc)
    codes = await generate_recovery_codes(db, flow.user_id, commit=False)
    await upgrade_onboarding_after_totp(
        db,
        flow.id,
        supabase_access_token=aal2_access,
        supabase_refresh_token=aal2_refresh,
        codes=codes,
    )
    await clear_rate_limit(
        db,
        scope="totp_verify",
        subject=flow.user_id,
        commit=False,
    )
    await db.commit()
    return MessageResponse(
        message="Google Authenticator đã được xác minh. Vui lòng lưu mã khôi phục."
    )


@router.post("/onboarding/recovery-codes", response_model=list[str])
async def get_onboarding_recovery_codes(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    return await take_onboarding_recovery_codes(request, db)


@router.post("/onboarding/recovery/confirm", response_model=TokenResponse)
async def confirm_onboarding_recovery_codes(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Atomically activate Viewer/bootstrap legacy account and issue AAL2 session."""
    flow = await mark_onboarding_recovery_codes_confirmed(request, db)
    profile_result = await db.execute(
        select(Profile).where(Profile.id == flow.user_id).with_for_update()
    )
    profile = profile_result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hồ sơ tài khoản không tồn tại.",
        )
    previous_status = profile.account_status
    if flow.invitation_id and previous_status != "pending":
        # The profile row is locked above, so an Owner disabling the account
        # while onboarding is in progress wins deterministically. A stale
        # pre-auth cookie must never be able to reactivate that account.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ tài khoản Dev."
                if previous_status == "disabled"
                else "Tài khoản không còn ở trạng thái chờ hoàn tất đăng ký."
            ),
        )
    if not flow.invitation_id and previous_status != "active":
        # Only the pre-created Owner/legacy account can onboard without an
        # invitation, and it must still be active at the final boundary.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản không có lời mời hợp lệ.",
        )
    google_result = await db.execute(
        select(AuthGoogleIdentity).where(
            AuthGoogleIdentity.user_id == flow.user_id,
            AuthGoogleIdentity.google_email == flow.email,
        )
    )
    if google_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản chưa liên kết Google hợp lệ.",
        )

    factor_result = await db.execute(
        select(AuthTotpFactor).where(AuthTotpFactor.user_id == flow.user_id)
    )
    factor = factor_result.scalar_one_or_none()
    if factor is None or factor.verified_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google Authenticator chưa được xác minh.",
        )

    if flow.invitation_id:
        await consume_invitation(
            db,
            invitation_id=flow.invitation_id,
            user_id=flow.user_id,
            email=flow.email,
        )
        profile.role = "viewer"

    now = datetime.now(timezone.utc)
    profile.account_status = "active"
    profile.approved_at = now
    profile.disabled_at = None
    profile.disabled_by = None
    profile.onboarding_completed_at = now
    profile.totp_enrolled_at = now
    access_token, refresh_token = read_upstream_credentials(flow)
    session_context = await upsert_device_session(
        db,
        user_id=flow.user_id,
        device_type=classify_device_type(request.headers),
        device_id=read_device_id(request),
        refresh_token=refresh_token,
        supabase_access_token=access_token,
        user_agent=read_request_user_agent(request),
        rotate_nonce=True,
        aal="aal2",
        mfa_factor_id=factor.provider_factor_id,
        mfa_verified_at=now,
        commit=False,
    )
    await record_account_security_event(
        db,
        actor_user_id=flow.user_id,
        target_user_id=flow.user_id,
        action="totp_enrolled",
        previous_role=profile.role,
        next_role=profile.role,
        previous_status=previous_status,
        next_status="active",
    )
    await record_account_security_event(
        db,
        actor_user_id=flow.user_id,
        target_user_id=flow.user_id,
        action="onboarding_completed",
        previous_status=previous_status,
        next_status="active",
    )
    await consume_flow_session(db, flow.id)
    await db.commit()
    token_response = await issue_internal_token(
        db,
        flow.user_id,
        flow.email,
        refresh_token,
        session_context,
        profile=profile,
        aal="aal2",
    )
    await delete_flow_session(db, flow.id, response)
    return token_response


@router.post("/login/totp/verify", response_model=TokenResponse)
async def login_totp_verify(
    payload: TotpVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    flow = await validate_flow_session(request, db, required_flow_type="login_mfa")
    await enforce_rate_limit(
        db,
        scope="totp_login",
        subject=flow.user_id,
        max_attempts=5,
        window_seconds=5 * 60,
    )
    access_token, _ = read_upstream_credentials(flow)
    factor, auth_data = await verify_totp_code(
        db,
        user_id=flow.user_id,
        code=payload.code.strip(),
        supabase_access_token=access_token,
    )
    aal2_access = auth_data.get("access_token")
    aal2_refresh = auth_data.get("refresh_token")
    if not isinstance(aal2_access, str) or not isinstance(aal2_refresh, str):
        raise HTTPException(status_code=502, detail="Phiên AAL2 không hợp lệ.")
    profile = (
        await db.execute(select(Profile).where(Profile.id == flow.user_id))
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    session_context = await upsert_device_session(
        db,
        user_id=flow.user_id,
        device_type=classify_device_type(request.headers),
        device_id=read_device_id(request),
        refresh_token=aal2_refresh,
        supabase_access_token=aal2_access,
        user_agent=read_request_user_agent(request),
        rotate_nonce=True,
        aal="aal2",
        mfa_factor_id=factor.provider_factor_id,
        mfa_verified_at=now,
        commit=False,
    )
    await clear_rate_limit(
        db,
        scope="totp_login",
        subject=flow.user_id,
        commit=False,
    )
    await consume_flow_session(db, flow.id)
    await db.commit()
    token_response = await issue_internal_token(
        db,
        flow.user_id,
        flow.email,
        aal2_refresh,
        session_context,
        profile=profile,
        aal="aal2",
    )
    await delete_flow_session(db, flow.id, response)
    return token_response


@router.post("/login/recovery/verify", response_model=TokenResponse)
async def login_recovery_verify(
    payload: RecoveryCodeLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    flow = await validate_flow_session(request, db, required_flow_type="login_mfa")
    await enforce_rate_limit(
        db,
        scope="recovery_login",
        subject=flow.user_id,
        max_attempts=5,
        window_seconds=10 * 60,
    )
    await use_recovery_code(
        db,
        user_id=flow.user_id,
        raw_code=payload.recovery_code,
        commit=False,
    )
    access_token, refresh_token = read_upstream_credentials(flow)
    if not await revoke_supabase_access_token(
        access_token,
        scope="others",
        operation="recovery-code login session revocation",
    ):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Chưa thể thu hồi các phiên cũ. Vui lòng thử lại để bảo vệ tài khoản.",
        )
    profile = (
        await db.execute(select(Profile).where(Profile.id == flow.user_id))
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    # A recovery code is an exceptional credential: retire every local session
    # before binding the newly recovered AAL2-equivalent session.
    await db.execute(
        delete(UserDeviceSession).where(UserDeviceSession.user_id == flow.user_id)
    )
    session_context = await upsert_device_session(
        db,
        user_id=flow.user_id,
        device_type=classify_device_type(request.headers),
        device_id=read_device_id(request),
        refresh_token=refresh_token,
        supabase_access_token=access_token,
        user_agent=read_request_user_agent(request),
        rotate_nonce=True,
        aal="aal2",
        mfa_factor_id="recovery-code",
        mfa_verified_at=now,
        commit=False,
    )
    await record_account_security_event(
        db,
        actor_user_id=flow.user_id,
        target_user_id=flow.user_id,
        action="recovery_code_used",
        previous_role=profile.role if profile else "viewer",
        next_role=profile.role if profile else "viewer",
    )
    await clear_rate_limit(
        db,
        scope="recovery_login",
        subject=flow.user_id,
        commit=False,
    )
    await consume_flow_session(db, flow.id)
    await db.commit()
    token_response = await issue_internal_token(
        db,
        flow.user_id,
        flow.email,
        refresh_token,
        session_context,
        profile=profile,
        aal="aal2",
    )
    await delete_flow_session(db, flow.id, response)
    return token_response
