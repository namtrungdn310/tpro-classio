import asyncio
import logging
import time

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from starlette.responses import Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.billing import get_billing_period_key
from app.core.database import AsyncSessionLocal
from app.core.http import supabase_auth_client
from app.routers.auth import router as auth_router
from app.routers.classes import router as classes_router
from app.routers.dashboard import router as dashboard_router
from app.routers.fees import router as fees_router
from app.routers.reports import router as reports_router
from app.routers.staff import router as staff_router
from app.routers.students import enrollments_router, students_router
from app.services.class_service import get_classes
from app.services.auth_flow_service import purge_expired_auth_flows
from app.services.dashboard_service import get_dashboard_overview
from app.services.fee_service import get_fee_records
from app.services.student_service import get_students
from app.services.google_identity_service import sync_due_google_avatars

logger = logging.getLogger("tpro_classio")
avatar_sync_task: asyncio.Task[None] | None = None
auth_flow_cleanup_task: asyncio.Task[None] | None = None

app = FastAPI(title="TPRO Classio API")
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_host_list,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "X-TPRO-Device-Id",
        "sec-ch-ua-mobile",
    ],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(auth_router, prefix="/auth")
app.include_router(classes_router, prefix="/classes")
app.include_router(dashboard_router, prefix="/dashboard")
app.include_router(fees_router, prefix="/fees")
app.include_router(reports_router, prefix="/reports")
app.include_router(staff_router, prefix="/staff")
app.include_router(students_router, prefix="/students")
app.include_router(enrollments_router, prefix="/enrollments")


@app.middleware("http")
async def log_slow_requests(request: Request, call_next) -> Response:
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "Request %s %s failed in %.1fms",
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Process-Time-MS"] = f"{duration_ms:.1f}"
    response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), browsing-topics=()"
    )

    if duration_ms >= 500:
        logger.warning(
            "Slow request %s %s completed in %.1fms with status %s",
            request.method,
            request.url.path,
            duration_ms,
            response.status_code,
        )

    return response


@app.get("/")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "app": "TPRO Classio API"}


@app.get("/health/ready")
async def readiness_check() -> dict[str, str]:
    """Readiness probe used by Docker/load balancers; verifies the DB is reachable."""
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
    return {"status": "ready", "app": "TPRO Classio API"}


@app.on_event("startup")
async def warm_database_on_startup() -> None:
    global auth_flow_cleanup_task, avatar_sync_task
    await warm_database_connection()
    auth_flow_cleanup_task = asyncio.create_task(run_auth_flow_cleanup_worker())
    if (
        settings.google_client_id
        and settings.google_client_secret
        and settings.supabase_service_role_key
        and settings.auth_encryption_key
    ):
        avatar_sync_task = asyncio.create_task(run_avatar_sync_worker())


async def run_auth_flow_cleanup_worker() -> None:
    """Purge expired credential-bearing pre-auth rows on every deployment."""
    while True:
        try:
            async with AsyncSessionLocal() as session:
                await purge_expired_auth_flows(session)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Expired auth-flow cleanup failed")
        await asyncio.sleep(5 * 60)


async def run_avatar_sync_worker() -> None:
    """Idempotently sync due Google avatars without delaying requests."""
    while True:
        try:
            async with AsyncSessionLocal() as session:
                await sync_due_google_avatars(session)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Periodic Google avatar sync failed")
        await asyncio.sleep(60 * 60)


async def warm_database_connection() -> None:
    started_at = time.perf_counter()
    try:
        async with AsyncSessionLocal() as session:
            db_started_at = time.perf_counter()
            await session.execute(text("select 1"))
            db_ms = (time.perf_counter() - db_started_at) * 1000

        cache_started_at = time.perf_counter()

        async def warm_classes() -> None:
            async with AsyncSessionLocal() as session:
                await get_classes(session, is_active=True)

        async def warm_dashboard() -> None:
            async with AsyncSessionLocal() as session:
                await get_dashboard_overview(session)

        async def warm_students() -> None:
            async with AsyncSessionLocal() as session:
                await get_students(session, status="active")

        async def warm_fees() -> None:
            async with AsyncSessionLocal() as session:
                await get_fee_records(session, get_billing_period_key())

        await asyncio.gather(
            warm_classes(),
            warm_dashboard(),
            warm_students(),
            warm_fees(),
        )
        cache_ms = (time.perf_counter() - cache_started_at) * 1000

        logger.info(
            "Database warmup completed in %.1fms (connect %.1fms, read caches %.1fms)",
            (time.perf_counter() - started_at) * 1000,
            db_ms,
            cache_ms,
        )
    except Exception:
        logger.exception("Database warmup failed")


@app.on_event("shutdown")
async def close_http_clients() -> None:
    global auth_flow_cleanup_task, avatar_sync_task
    if auth_flow_cleanup_task is not None:
        auth_flow_cleanup_task.cancel()
        try:
            await auth_flow_cleanup_task
        except asyncio.CancelledError:
            pass
        auth_flow_cleanup_task = None
    if avatar_sync_task is not None:
        avatar_sync_task.cancel()
        try:
            await avatar_sync_task
        except asyncio.CancelledError:
            pass
        avatar_sync_task = None
    await supabase_auth_client.aclose()
