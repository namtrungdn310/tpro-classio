"""Auth router package — assembles all auth sub-routers into a single FastAPI router."""

from fastapi import APIRouter

from app.routers.auth.registration import router as registration_router
from app.routers.auth.mfa import router as mfa_router
from app.routers.auth.session import router as session_router
from app.routers.auth.invitations import router as invitations_router
from app.routers.auth.users import router as users_router
from app.routers.auth.google import router as google_router

router = APIRouter()
router.include_router(session_router)
router.include_router(registration_router)
router.include_router(mfa_router)
router.include_router(invitations_router)
router.include_router(users_router)
router.include_router(google_router)
