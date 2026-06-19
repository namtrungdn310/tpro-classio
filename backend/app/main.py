import asyncio
import logging
import time

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http import supabase_auth_client
from app.routers.auth import router as auth_router
from app.routers.classes import router as classes_router
from app.services.class_service import get_classes

logger = logging.getLogger("tpro_classio")

app = FastAPI(title="TPRO Classio API")

allowed_origins = ["http://localhost:3000"]
if settings.frontend_url and settings.frontend_url not in allowed_origins:
    allowed_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
app.include_router(classes_router, prefix="/classes")


@app.middleware("http")
async def log_slow_requests(request: Request, call_next) -> Response:
    started_at = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started_at) * 1000

    if duration_ms >= 1000:
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


@app.on_event("startup")
async def schedule_database_warmup() -> None:
    asyncio.create_task(warm_database_connection())


async def warm_database_connection() -> None:
    started_at = time.perf_counter()
    try:
        async with AsyncSessionLocal() as session:
            db_started_at = time.perf_counter()
            await session.execute(text("select 1"))
            db_ms = (time.perf_counter() - db_started_at) * 1000

            classes_started_at = time.perf_counter()
            await get_classes(session, is_active=True)
            classes_ms = (time.perf_counter() - classes_started_at) * 1000

        logger.info(
            "Database warmup completed in %.1fms (connect %.1fms, classes %.1fms)",
            (time.perf_counter() - started_at) * 1000,
            db_ms,
            classes_ms,
        )
    except Exception:
        logger.exception("Database warmup failed")


@app.on_event("shutdown")
async def close_http_clients() -> None:
    await supabase_auth_client.aclose()
