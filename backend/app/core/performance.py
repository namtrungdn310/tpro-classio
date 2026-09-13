import logging
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator

PERFORMANCE_LOGGER = "tpro_classio.performance"

# Thresholds shared by the database engine events and the HTTP middleware.
REQUEST_SLOW_MS = 500.0
QUERY_SLOW_MS = 100.0
MAX_SQL_PER_REQUEST = 20
POOL_WAIT_SLOW_MS = 100.0
MAX_SLOW_QUERIES_CAPTURED = 10
SQL_LABEL_MAX_LENGTH = 160


@dataclass
class QueryTiming:
    """One slow SQL statement.  Statement text is sanitized and truncated and
    never includes bound parameters, so it cannot leak PII."""

    statement: str
    duration_ms: float


@dataclass
class RequestMetrics:
    """Per-request DB instrumentation fed by engine/session events."""

    sql_count: int = 0
    db_total_ms: float = 0.0
    pool_wait_ms: float = 0.0
    slow_queries: list[QueryTiming] = field(default_factory=list)


_request_metrics: ContextVar[RequestMetrics | None] = ContextVar(
    "tpro_request_metrics", default=None
)


@contextmanager
def track_request_metrics() -> Iterator[RequestMetrics]:
    """Bind a fresh RequestMetrics to the current request context."""
    token = _request_metrics.set(RequestMetrics())
    try:
        yield _request_metrics.get()  # type: ignore[return-value]
    finally:
        _request_metrics.reset(token)


def get_request_metrics() -> RequestMetrics | None:
    return _request_metrics.get()


def record_sql(statement: str, duration_ms: float) -> None:
    metrics = _request_metrics.get()
    if metrics is None:
        return
    metrics.sql_count += 1
    metrics.db_total_ms += duration_ms
    if (
        duration_ms >= QUERY_SLOW_MS
        and len(metrics.slow_queries) < MAX_SLOW_QUERIES_CAPTURED
    ):
        metrics.slow_queries.append(
            QueryTiming(_sanitize_sql_label(statement), duration_ms)
        )


def record_pool_wait(duration_ms: float) -> None:
    metrics = _request_metrics.get()
    if metrics is None:
        return
    metrics.pool_wait_ms = max(metrics.pool_wait_ms, duration_ms)


def _sanitize_sql_label(statement: str) -> str:
    """Strip quoted literals and collapse whitespace before truncating."""
    cleaned = re.sub(r"'[^']*'", "?", statement)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > SQL_LABEL_MAX_LENGTH:
        cleaned = f"{cleaned[:SQL_LABEL_MAX_LENGTH]}..."
    return cleaned


def request_metrics_breached(
    metrics: RequestMetrics | None,
    duration_ms: float,
) -> bool:
    if metrics is None:
        return duration_ms >= REQUEST_SLOW_MS
    return (
        duration_ms >= REQUEST_SLOW_MS
        or metrics.sql_count > MAX_SQL_PER_REQUEST
        or metrics.pool_wait_ms >= POOL_WAIT_SLOW_MS
        or bool(metrics.slow_queries)
    )


def log_request_metrics_summary(
    *,
    method: str,
    path: str,
    status: int,
    request_id: str | None,
    duration_ms: float,
    response_size: int,
    metrics: RequestMetrics | None,
) -> None:
    """Emit one structured log line per request at the appropriate level.

    WARNING when any breach threshold is crossed (slow request, slow query,
    too many SQL statements, pool wait).  INFO for notable requests and DEBUG
    for the rest.  Health probes are always DEBUG to keep the healthcheck loop
    quiet.
    """
    logger = logging.getLogger(PERFORMANCE_LOGGER)
    slow_queries = metrics.slow_queries if metrics is not None else []
    slow_summary = (
        "; ".join(
            f"{item.statement} ({item.duration_ms:.1f}ms)" for item in slow_queries
        )
        if slow_queries
        else "-"
    )
    message = (
        f"{method} {path} status={status} request_id={request_id or '-'} "
        f"total_ms={duration_ms:.1f} db_ms={metrics.db_total_ms:.1f} "
        f"sql_count={metrics.sql_count} "
        f"pool_wait_ms={metrics.pool_wait_ms:.1f} "
        f"bytes={response_size} slow_queries={slow_summary}"
    )
    if request_metrics_breached(metrics, duration_ms):
        logger.warning(message)
    elif duration_ms >= 200 or (metrics is not None and metrics.sql_count >= 10):
        logger.info(message)
    else:
        logger.debug(message)


@contextmanager
def log_timing(
    label: str,
    *,
    threshold_ms: float = 50,
    logger_name: str = PERFORMANCE_LOGGER,
    **meta: str | int | float | bool | None,
) -> Iterator[None]:
    started_at = time.perf_counter()
    try:
        yield
    finally:
        duration_ms = (time.perf_counter() - started_at) * 1000
        if duration_ms >= threshold_ms:
            logger = logging.getLogger(logger_name)
            meta_text = " ".join(
                f"{key}={value}" for key, value in meta.items() if value is not None
            )
            message = f"{label} took {duration_ms:.1f}ms"
            if meta_text:
                message = f"{message} {meta_text}"

            if duration_ms >= threshold_ms * 3:
                logger.warning(message)
            else:
                logger.info(message)
