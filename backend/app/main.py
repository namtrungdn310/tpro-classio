import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from starlette.responses import Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http import supabase_auth_client
from app.routers.attendance import router as attendance_router
from app.routers.auth import router as auth_router
from app.routers.class_makeup import exception_router as class_exception_router
from app.routers.class_makeup import router as class_makeup_router
from app.routers.classes import router as classes_router
from app.routers.contact_suggestions import router as contact_suggestions_router
from app.routers.dashboard import router as dashboard_router
from app.routers.fees import router as fees_router
from app.routers.reports import router as reports_router
from app.routers.staff import router as staff_router
from app.routers.students import enrollments_router, students_router
from app.routers.suspensions import router as suspensions_router
from app.services.class_service import complete_expired_classes
from app.services.auth_flow_service import purge_expired_auth_flows
from app.services.google_identity_service import sync_due_google_avatars

logger = logging.getLogger("tpro_classio")
avatar_sync_task: asyncio.Task[None] | None = None
auth_flow_cleanup_task: asyncio.Task[None] | None = None
class_lifecycle_task: asyncio.Task[None] | None = None

# A successful TCP/SELECT 1 probe is not enough after a forward-only domain
# rollout: an old Supabase schema can accept connections while every new
# business endpoint fails at runtime.  These relations are stable markers for
# migrations 055, 059, 063, 067, 068, 071 and 073 respectively.  Keeping the
# list small makes the readiness query bounded while still failing closed when
# the Round 6/7 schema has not been installed.
_REQUIRED_SCHEMA_RELATIONS = (
    "student_code_registry",
    "class_schedule_slots",
    "enrollment_service_credit_events",
    "staff_attendance_entries",
    "payment_requests",
    "staff_payroll_settlements",
    "staff_payroll_settlement_reversals",
)


async def missing_required_schema_relations(session) -> list[str]:
    result = await session.execute(
        text(
            "select required.name "
            "from unnest(cast(:required_relations as text[])) as required(name) "
            "where to_regclass('public.' || required.name) is null "
            "order by required.name"
        ),
        {"required_relations": list(_REQUIRED_SCHEMA_RELATIONS)},
    )
    return list(result.scalars().all())


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


async def run_class_lifecycle_worker() -> None:
    """Finalize expired classes without making request visibility depend on it."""
    while True:
        try:
            async with AsyncSessionLocal() as session:
                completed = await complete_expired_classes(session)
                if completed:
                    logger.info("Finalized %s expired class(es)", completed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Class lifecycle completion worker failed")
        await asyncio.sleep(60)


async def warm_database_connection() -> None:
    """R6-D18: bounded readiness probe — SELECT 1 only (no full-read warmup)."""
    started_at = time.perf_counter()
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("select 1"))
        logger.info(
            "Database connection warmup completed in %.1fms",
            (time.perf_counter() - started_at) * 1000,
        )
    except Exception:
        logger.exception("Database connection warmup failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global auth_flow_cleanup_task, avatar_sync_task, class_lifecycle_task
    await warm_database_connection()
    auth_flow_cleanup_task = asyncio.create_task(run_auth_flow_cleanup_worker())
    class_lifecycle_task = asyncio.create_task(run_class_lifecycle_worker())
    if (
        settings.google_client_id
        and settings.google_client_secret
        and settings.supabase_service_role_key
        and settings.auth_encryption_key
    ):
        avatar_sync_task = asyncio.create_task(run_avatar_sync_worker())

    yield

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
    if class_lifecycle_task is not None:
        class_lifecycle_task.cancel()
        try:
            await class_lifecycle_task
        except asyncio.CancelledError:
            pass
        class_lifecycle_task = None
    await supabase_auth_client.aclose()


app = FastAPI(
    title="TPRO Classio API",
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url="/redoc" if settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
    lifespan=lifespan,
)
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
app.include_router(attendance_router, prefix="/attendance")
app.include_router(classes_router, prefix="/classes")
app.include_router(class_makeup_router, prefix="/classes")
app.include_router(class_exception_router, prefix="/class-session-exceptions")
app.include_router(contact_suggestions_router, prefix="/contact-suggestions")
app.include_router(dashboard_router, prefix="/dashboard")
app.include_router(fees_router, prefix="/fees")
app.include_router(reports_router, prefix="/reports")
app.include_router(staff_router, prefix="/staff")
app.include_router(students_router, prefix="/students")
app.include_router(enrollments_router, prefix="/enrollments")
app.include_router(suspensions_router, prefix="/classes")


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


@app.get("/health/live")
async def liveness_check() -> dict[str, str]:
    """Process liveness; intentionally does not depend on external services."""
    return {"status": "live", "app": "TPRO Classio API"}


@app.get("/health/ready")
async def readiness_check() -> dict[str, str]:
    """Verify both DB reachability and the minimum application schema contract."""
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
        missing = await missing_required_schema_relations(session)
    if missing:
        logger.error(
            "Readiness blocked: database schema is missing %s required relation(s)",
            len(missing),
        )
        raise HTTPException(
            status_code=503,
            detail="Database schema is not ready for this application version",
        )
    return {"status": "ready", "app": "TPRO Classio API"}
