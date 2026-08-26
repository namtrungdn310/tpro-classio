import asyncio
import logging
import time
import uuid
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
from app.core.database import (
    AsyncSessionLocal,
    release_advisory_lock,
    try_advisory_lock,
)
from app.core.http import supabase_auth_client
from app.core.performance import (
    get_request_metrics,
    log_request_metrics_summary,
    track_request_metrics,
)
from app.routers.attendance import router as attendance_router
from app.routers.banking import router as banking_router
from app.routers.pay2s_webhook import router as pay2s_webhook_router
from app.routers.ops import router as ops_router
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

# Readiness probe cache: a burst of container healthchecks shares one probe.
_READINESS_CACHE_TTL_SECONDS = 30
_READINESS_CACHE_AT: float = 0.0
_READINESS_CACHE_OK: bool | None = None
_READINESS_LOCK = asyncio.Lock()

# A successful TCP/SELECT 1 probe is not enough after a forward-only domain
# rollout: an old Supabase schema can accept connections while every new
# business endpoint fails at runtime.  These relations are stable markers for
# migrations 055, 059, 063, 067, 068, 071, 074, 076 and 077 respectively. Keeping the
# list small makes the readiness query bounded while still failing closed when
# the Round 6/7 schema has not been installed.
_REQUIRED_SCHEMA_RELATIONS = (
    "student_code_registry",
    "class_schedule_slots",
    "enrollment_service_credit_events",
    "staff_attendance_entries",
    "payment_requests",
    "payment_request_items",
    "workspace_payment_accounts",
    "workspace_payment_providers",
    "workspace_payment_webhooks",
    "staff_payroll_settlements",
    "staff_payroll_settlement_reversals",
    "class_schedule_slot_teacher_events",
)

# Several forward migrations provide trigger-only invariants. Readiness must
# verify those objects too, otherwise an old schema can report healthy while
# direct writers bypass suspension or payroll/schedule invariants.
_REQUIRED_SCHEMA_TRIGGERS = (
    "class_schedule_adjustments:trg_class_schedule_adjustments_no_overlap",
    "enrollments:trg_enrollments_no_open_suspension",
    "class_schedule_slot_teacher_events:class_schedule_slot_teacher_events_append_only",
    "staff_earning_ledger:staff_earning_rate_snapshot_integrity",
)

_REQUIRED_SCHEMA_FUNCTIONS = (
    "ops.platform_overview()",
    "ops.disable_workspace_pay2s(uuid,uuid,text)",
)

_REQUIRED_SCHEMA_COLUMNS = (
    "payment_requests:sent_channel",
    "payment_requests:send_count",
    "payment_request_events:idempotency_key",
    "payment_request_events:event_metadata",
    "workspace_payment_providers:plan",
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


async def missing_required_schema_features(session) -> list[str]:
    """Return missing trigger-backed schema features for the current release."""
    result = await session.execute(
        text(
            "select required.name "
            "from unnest(cast(:required_triggers as text[])) as required(name) "
            "where not exists ("
            "  select 1 from pg_trigger tg "
            "  join pg_class rel on rel.oid = tg.tgrelid "
            "  join pg_namespace ns on ns.oid = rel.relnamespace "
            "  where ns.nspname = 'public' "
            "    and rel.relname = split_part(required.name, ':', 1) "
            "    and tg.tgname = split_part(required.name, ':', 2) "
            "    and not tg.tgisinternal"
            ") order by required.name"
        ),
        {"required_triggers": list(_REQUIRED_SCHEMA_TRIGGERS)},
    )
    return list(result.scalars().all())


async def missing_required_schema_functions(session) -> list[str]:
    result = await session.execute(
        text(
            "select required.name "
            "from unnest(cast(:required_functions as text[])) as required(name) "
            "where to_regprocedure(required.name) is null "
            "order by required.name"
        ),
        {"required_functions": list(_REQUIRED_SCHEMA_FUNCTIONS)},
    )
    return list(result.scalars().all())


async def missing_required_schema_columns(session) -> list[str]:
    result = await session.execute(
        text(
            "select required.name "
            "from unnest(cast(:required_columns as text[])) as required(name) "
            "where not exists ("
            "  select 1 from information_schema.columns column_ "
            "  where column_.table_schema = 'public' "
            "    and column_.table_name = split_part(required.name, ':', 1) "
            "    and column_.column_name = split_part(required.name, ':', 2)"
            ") order by required.name"
        ),
        {"required_columns": list(_REQUIRED_SCHEMA_COLUMNS)},
    )
    return list(result.scalars().all())


# Stable advisory-lock keys so multiple uvicorn workers never process the same
# background batch twice.  Keep them distinct per worker type.
_CLASS_LIFECYCLE_LOCK_KEY = 9_081_011
_AUTH_FLOW_CLEANUP_LOCK_KEY = 9_081_012
_AVATAR_SYNC_LOCK_KEY = 9_081_013


async def _try_run_worker(
    lock_key: int,
    task,
    *,
    label: str,
) -> None:
    """Run ``task(session)`` once under a session-level advisory lock.

    When another worker already holds the lock, this cycle is skipped instead
    of duplicating the batch.  The lock is acquired and released on the same
    session, so the task's commits never release it early.
    """
    async with AsyncSessionLocal() as session:
        acquired = await try_advisory_lock(session, lock_key)
        if not acquired:
            return
        try:
            started_at = time.perf_counter()
            result = await task(session)
            duration_ms = (time.perf_counter() - started_at) * 1000
            if result:
                logger.info("%s: %s item(s) in %.1fms", label, result, duration_ms)
            else:
                logger.debug("%s: no items in %.1fms", label, duration_ms)
        finally:
            await release_advisory_lock(session, lock_key)


async def run_auth_flow_cleanup_worker() -> None:
    """Purge expired credential-bearing pre-auth rows on every deployment."""
    while True:
        try:
            await _try_run_worker(
                _AUTH_FLOW_CLEANUP_LOCK_KEY,
                purge_expired_auth_flows,
                label="Expired auth-flow cleanup",
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Expired auth-flow cleanup failed")
        await asyncio.sleep(5 * 60)


async def run_avatar_sync_worker() -> None:
    """Idempotently sync due Google avatars without delaying requests."""
    while True:
        try:
            await _try_run_worker(
                _AVATAR_SYNC_LOCK_KEY,
                sync_due_google_avatars,
                label="Google avatar sync",
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Periodic Google avatar sync failed")
        await asyncio.sleep(60 * 60)


async def run_class_lifecycle_worker() -> None:
    """Finalize expired classes without making request visibility depend on it."""
    while True:
        try:
            await _try_run_worker(
                _CLASS_LIFECYCLE_LOCK_KEY,
                complete_expired_classes,
                label="Class lifecycle completion",
            )
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
app.include_router(banking_router, prefix="/banking")
app.include_router(pay2s_webhook_router, prefix="/webhooks")
app.include_router(ops_router, prefix="/ops")
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
async def instrument_requests(request: Request, call_next) -> Response:
    started_at = time.perf_counter()
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    with track_request_metrics():
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started_at) * 1000
            logger.exception(
                "Request %s %s failed in %.1fms request_id=%s",
                request.method,
                request.url.path,
                duration_ms,
                request_id,
            )
            raise

        duration_ms = (time.perf_counter() - started_at) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time-MS"] = f"{duration_ms:.1f}"
        response.headers["Server-Timing"] = (
            f"app;dur={duration_ms:.1f};desc=total,"
            f"db;dur={get_request_metrics().db_total_ms:.1f}"
        )
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), browsing-topics=()"
        )

        body = getattr(response, "body", None)
        if body is not None:
            response_size = len(body)
        else:
            try:
                response_size = int(response.headers.get("content-length", "0") or 0)
            except ValueError:
                response_size = 0

        if request.url.path not in {"/health/live", "/health/ready"}:
            log_request_metrics_summary(
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                request_id=request_id,
                duration_ms=duration_ms,
                response_size=response_size,
                metrics=get_request_metrics(),
            )

    return response


@app.get("/")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "app": "TPRO Classio API"}


@app.get("/health/live")
async def liveness_check() -> dict[str, str]:
    """Process liveness; intentionally does not depend on external services."""
    return {"status": "live", "app": "TPRO Classio API"}


async def _readiness_probe() -> list[str]:
    """Run the full readiness probe and return missing schema markers."""
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
        missing = await missing_required_schema_relations(session)
        missing.extend(await missing_required_schema_features(session))
        missing.extend(await missing_required_schema_functions(session))
        missing.extend(await missing_required_schema_columns(session))
    return missing


async def _readiness_result() -> bool:
    """Cached, lock-protected readiness evaluation.

    Concurrent healthcheck bursts share one probe; the result is cached for a
    short TTL so the metadata schema check never runs on every request.
    """
    global _READINESS_CACHE_AT, _READINESS_CACHE_OK
    cache_age = time.monotonic() - _READINESS_CACHE_AT
    if cache_age < _READINESS_CACHE_TTL_SECONDS and _READINESS_CACHE_OK is not None:
        return _READINESS_CACHE_OK

    async with _READINESS_LOCK:
        cache_age = time.monotonic() - _READINESS_CACHE_AT
        if cache_age < _READINESS_CACHE_TTL_SECONDS and _READINESS_CACHE_OK is not None:
            return _READINESS_CACHE_OK

        probe_started_at = time.perf_counter()
        try:
            missing = await _readiness_probe()
        except Exception:
            _READINESS_CACHE_OK = False
            _READINESS_CACHE_AT = time.monotonic()
            logger.exception(
                "Readiness probe failed after %.1fms",
                (time.perf_counter() - probe_started_at) * 1000,
            )
            return False

        probe_ms = (time.perf_counter() - probe_started_at) * 1000
        _READINESS_CACHE_AT = time.monotonic()
        if missing:
            _READINESS_CACHE_OK = False
            logger.error(
                "Readiness blocked: database schema is missing %s required "
                "relation(s) after %.1fms",
                len(missing),
                probe_ms,
            )
            return False
        _READINESS_CACHE_OK = True
        logger.info("Readiness probe completed in %.1fms", probe_ms)
        return True


@app.get("/health/ready")
async def readiness_check() -> dict[str, str]:
    """Verify both DB reachability and the minimum application schema contract.

    The probe result is cached for a short TTL behind an async lock so a burst
    of container healthchecks does not run many schema probes at once.  The
    first probe still runs the full check and fails closed; a later fixed DB
    is re-probed as soon as the cache expires.
    """
    if not await _readiness_result():
        raise HTTPException(
            status_code=503,
            detail="Database schema is not ready for this application version",
        )
    return {"status": "ready", "app": "TPRO Classio API"}
