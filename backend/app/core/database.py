import ssl
import time
from collections.abc import AsyncGenerator
from contextvars import ContextVar

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, declarative_base, with_loader_criteria

from app.core.config import settings
from app.core.performance import record_sql
from app.core.workspace import (
    WorkspaceScoped,
    get_workspace_id,
    reset_workspace_id,
    set_workspace_id,
)

connect_args: dict[str, object] = {
    # Bound both the TCP handshake and each asyncpg command so provider
    # outages cannot pin an API worker indefinitely.
    "timeout": 10,
    "command_timeout": 30,
}

if settings.database_ssl_mode == "verify-full":
    database_ssl_context = ssl.create_default_context(
        cafile=settings.database_ssl_root_cert_path
    )
    database_ssl_context.check_hostname = True
    database_ssl_context.verify_mode = ssl.CERT_REQUIRED
    connect_args["ssl"] = database_ssl_context
elif settings.database_ssl_mode == "require":
    connect_args["ssl"] = "require"

engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
    pool_timeout=settings.database_pool_timeout,
    # SQLAlchemy exception strings otherwise include bound values such as
    # student names, phone numbers and notes.
    hide_parameters=True,
    connect_args=connect_args,
)
AsyncSessionLocal = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)
Base = (
    declarative_base()
)  # class python ở /models kế thừa class base, mục đích: quản lý và đồng bộ


@event.listens_for(Session, "before_flush")
def _stamp_workspace_rows(session, flush_context, instances) -> None:
    """Stamp new business rows and reject cross-workspace relationships.

    The database trigger remains the last line of defence for SQL that does
    not go through SQLAlchemy.  Keeping this check in the ORM gives callers a
    deterministic error before a transaction reaches the database and avoids
    accidentally creating an unscoped row when a service forgets a field.
    """
    workspace_id = get_workspace_id()
    if not workspace_id:
        return
    for obj in session.new:
        if isinstance(obj, WorkspaceScoped):
            row_workspace = getattr(obj, "workspace_id", None)
            if row_workspace is None:
                obj.workspace_id = workspace_id
            elif str(row_workspace) != workspace_id:
                # An admin invitation is intentionally created in a fresh,
                # owner-less workspace before the invited account exists.
                # The database trigger validates that special cross-tenant
                # hand-off; all other business rows must match the request.
                if (
                    obj.__class__.__name__ == "AccountInvitation"
                    and getattr(obj, "role", None) == "admin"
                ):
                    continue
                raise ValueError("business row belongs to another workspace")


@event.listens_for(Session, "do_orm_execute")
def _apply_workspace_boundary(execute_state) -> None:
    """Apply a tenant criterion to every mapped workspace-scoped entity.

    ``tpro_runtime`` is intentionally a service role and may bypass PostgreSQL
    RLS in Supabase.  Therefore tenant filtering cannot rely on RLS alone: the
    same boundary is attached to every ORM SELECT/UPDATE/DELETE statement.
    """
    workspace_id = get_workspace_id()
    if not workspace_id or not (
        execute_state.is_select or execute_state.is_update or execute_state.is_delete
    ):
        return
    statement = execute_state.statement
    for mapper in tuple(Base.registry.mappers):
        model = mapper.class_
        if not isinstance(model, type) or not issubclass(model, WorkspaceScoped):
            continue
        statement = statement.options(
            with_loader_criteria(
                model,
                lambda cls, workspace_id=workspace_id: cls.workspace_id == workspace_id,
                include_aliases=True,
            )
        )
    execute_state.statement = statement


# Per-request SQL instrumentation.  A LIFO stack tracks each connection
# execute call so nested loads (selectinload, lazy relations) are measured
# separately.  The stack is request-scoped through a ContextVar, and every
# execute inside the same request runs sequentially on its own connection.
_execution_stack: ContextVar[list[float]] = ContextVar(
    "tpro_execution_stack", default=[]
)


def _statement_label(clauseelement: object) -> str:
    try:
        return str(clauseelement)
    except Exception:
        return "<unknown>"


@event.listens_for(engine.sync_engine, "before_execute")
def _before_engine_execute(
    conn, clauseelement, multiparams, params, execution_options
) -> None:
    _execution_stack.get().append(time.perf_counter())


@event.listens_for(engine.sync_engine, "after_execute")
def _after_engine_execute(
    conn, clauseelement, multiparams, params, execution_options, result
) -> None:
    stack = _execution_stack.get()
    if not stack:
        return
    started_at = stack.pop()
    record_sql(
        _statement_label(clauseelement),
        (time.perf_counter() - started_at) * 1000,
    )


async def get_db() -> (
    AsyncGenerator[AsyncSession, None]
):  # là hàm Dependency Injection, được gọi liên tục ở /routers nhằm cung cấp DB cho các API
    workspace_token = set_workspace_id("")
    async with AsyncSessionLocal() as session:
        try:
            # A pooled connection may have served another request.  Clear the
            # session-level GUC before authentication; ``resolve_principal``
            # sets it again after it has verified the profile membership.
            # Session scope (rather than transaction scope) is required because
            # service methods legitimately commit more than once per request.
            await session.execute(
                text("select set_config('app.workspace_id', '', false)")
            )
            await session.commit()
            yield session
        finally:
            # A request may be served by a reused asyncio task in tests or by
            # middleware that performs more than one dependency resolution.
            # Never let the previous admin's boundary leak into the next one.
            try:
                await session.rollback()
                await session.execute(
                    text("select set_config('app.workspace_id', '', false)")
                )
                await session.commit()
            finally:
                reset_workspace_id(workspace_token)


async def try_advisory_lock(db: AsyncSession, key: int) -> bool:
    """Non-blocking PostgreSQL session-level advisory lock claim.

    Used by background workers so multiple uvicorn processes never process the
    same batch twice.  Session-level locks survive the worker's commits and are
    released by :func:`release_advisory_lock` (or when the connection closes).
    """
    result = await db.execute(
        text("select pg_try_advisory_lock(:lock_key)"), {"lock_key": key}
    )
    return bool(result.scalar())


async def release_advisory_lock(db: AsyncSession, key: int) -> None:
    await db.execute(text("select pg_advisory_unlock(:lock_key)"), {"lock_key": key})
