from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.contact_suggestion import (
    ContactSuggestionLookup,
    ContactSuggestionResponse,
)
from app.services.contact_suggestion_service import lookup_contact_suggestion

router = APIRouter(tags=["contact-suggestions"])


@router.post("/lookup", response_model=ContactSuggestionResponse | None)
async def lookup_contact_suggestion_route(
    payload: ContactSuggestionLookup,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ContactSuggestionResponse | None:
    return await lookup_contact_suggestion(db, payload)
