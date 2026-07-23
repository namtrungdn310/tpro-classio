"""Invitations router: create, list and revoke account invitations (owner only)."""

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import require_owner
from app.schemas.auth import (
    InvitationCreate,
    InvitationResponse,
    InvitationSummary,
    MessageResponse,
)
from app.services.invitation_service import (
    create_invitation,
    list_invitations,
    revoke_invitation,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger("tpro_classio.auth.invitations")


@router.post("/invitations", response_model=InvitationResponse)
async def create_account_invitation(
    payload: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> InvitationResponse:
    """Create an invitation link for a new viewer account."""
    invited_by = str(current_user["id"] or "")

    raw_token, invitation = await create_invitation(
        db, email=payload.email.strip().lower(), invited_by=invited_by
    )

    # Build full invitation URL for the frontend
    base_url = getattr(settings, "frontend_url", "") or "http://localhost:3000"
    invite_url = f"{base_url.rstrip('/')}/register?" + urlencode(
        {"token": raw_token, "email": payload.email.strip().lower()}
    )

    return InvitationResponse(
        id=str(invitation.id),
        email=invitation.email,
        role=invitation.role,
        invite_url=invite_url,
        expires_at=invitation.expires_at.isoformat(),
        consumed=invitation.consumed_at is not None,
        revoked=invitation.revoked_at is not None,
        created_at=invitation.created_at.isoformat(),
    )


@router.get("/invitations", response_model=list[InvitationSummary])
async def list_account_invitations(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> list[InvitationSummary]:
    invited_by = str(current_user["id"] or "")
    invitations = await list_invitations(db, invited_by=invited_by)
    return [
        InvitationSummary(
            id=str(inv.id),
            email=inv.email,
            role=inv.role,
            expires_at=inv.expires_at.isoformat(),
            consumed=inv.consumed_at is not None,
            revoked=inv.revoked_at is not None,
            created_at=inv.created_at.isoformat(),
        )
        for inv in invitations
    ]


@router.delete("/invitations/{invitation_id}", response_model=MessageResponse)
async def revoke_account_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_owner),
) -> MessageResponse:
    await revoke_invitation(db, invitation_id)
    return MessageResponse(message="Lời mời đã bị thu hồi.")
