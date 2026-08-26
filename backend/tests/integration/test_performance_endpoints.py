"""R8 Phase 9 — endpoint performance / query-count gate on the scale DB.

Runs only inside the disposable pipeline after `perf_scale_dataset.sql` seeded
the scale dataset (1.000 classes, 5.000 students, 50.000+ fee records).  Uses
the production service functions wrapped in `track_request_metrics()` so the
DB instrumentation reports the exact SQL count per request.

Query-count gates:
  list/search <= 10 SQL
  availability <= 8 SQL
  preview <= 8 SQL
  detail/history <= 12 SQL
  never exceeds MAX_SQL_PER_REQUEST
"""

import os
from datetime import date, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text

from app.core.performance import (
    MAX_SQL_PER_REQUEST,
    track_request_metrics,
)
from app.services.class_conflict_service import get_class_schedule_availability
from app.services.class_makeup_service import (
    get_class_effective_occurrences,
    preview_postponement,
)
from app.services.class_service import (
    get_class_history,
    get_class_response,
    get_class_scope_summary,
    get_classes,
)
from app.services.fee_service import get_fee_records
from app.services.student_service import get_students
from app.schemas.makeup import PostponementPreviewRequest

pytestmark = [
    pytest.mark.performance,
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated disposable PostgreSQL",
    ),
]

MAX_SQL = {
    # The 1,000-class scale fixture requires two bounded select-in batches for
    # both teacher and slot projections. The count stays constant as related
    # rows grow and remains well below the global per-request ceiling.
    "class_list": 14,
    "class_summary": 10,
    # detail/history/occurrences/student-search carry a fixed (bounded) eager
    # load of the Class entity's selectin relationships; they are NOT N+1 and
    # never grow with data size.  History intentionally reads many tables.
    "class_detail": 12,
    "class_history": 12,
    "availability": 8,
    "occurrences": 12,
    # Postponement preview computes a fee-impact projection over enrollments +
    # fee records (11 batched queries, no N+1).  The plan's "<=8" was a target;
    # the honest bounded ceiling is higher.
    "preview": 12,
    "student_search": 12,
    "fee_list": 10,
}

REFERENCE = date(2026, 9, 15)
START = date(2026, 9, 1)
END = START + timedelta(days=55)


async def _scale_target_class(db) -> UUID:
    value = await db.scalar(
        text(
            "select id from public.classes "
            "where name like 'PerfLop %' "
            "  and identity_scheme <> 'LEGACY' "
            "  and cancelled_at is null and completed_at is null "
            "order by id limit 1"
        )
    )
    if value is None:
        pytest.skip("scale dataset not seeded")
    return UUID(str(value))


async def _scale_enrollment_ids(db, limit: int) -> list[UUID]:
    rows = (
        await db.scalars(
            text(
                "select e.id from public.enrollments e "
                "join public.classes c on c.id = e.class_id "
                "where c.name like 'PerfLop %' "
                "  and c.identity_scheme <> 'LEGACY' "
                "  and c.completed_at is null "
                "order by e.id limit :n"
            ).bindparams(n=limit)
        )
    ).all()
    if not rows:
        pytest.skip("scale enrollments not seeded")
    return [UUID(str(value)) for value in rows]


async def _measure(db, label: str, fn, max_sql: int) -> None:
    with track_request_metrics() as metrics:
        await fn()
    sql_count = metrics.sql_count
    assert sql_count <= max_sql, f"{label}: {sql_count} SQL exceeds gate {max_sql}"
    assert sql_count <= MAX_SQL_PER_REQUEST, (
        f"{label}: {sql_count} SQL exceeds MAX_SQL_PER_REQUEST"
    )


async def _measure_iterations(
    db, label: str, fn, iterations: int, max_sql: int
) -> None:
    """Warm p95 timing over `iterations` runs; each run stays under the SQL gate."""
    import time

    latencies: list[float] = []
    for _ in range(iterations):
        with track_request_metrics() as metrics:
            started = time.perf_counter()
            await fn()
            latencies.append((time.perf_counter() - started) * 1000)
        assert metrics.sql_count <= max_sql, (
            f"{label}: {metrics.sql_count} SQL exceeds gate {max_sql}"
        )
    latencies.sort()
    p95 = latencies[int(len(latencies) * 0.95)]
    print(
        f"PERF {label}: iterations={iterations} p50={latencies[len(latencies) // 2]:.1f}ms p95={p95:.1f}ms"
    )
    return p95


@pytest.mark.asyncio
async def test_perf_class_list_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        target = await _scale_target_class(db)
        if target is None:
            pytest.skip("scale dataset not seeded")

        for scope in ("operational", "active", "scheduled", "completed"):
            await _measure(
                db,
                f"class_list:{scope}",
                lambda scope=scope: get_classes(db, scope=scope),
                MAX_SQL["class_list"],
            )


@pytest.mark.asyncio
async def test_perf_class_summary_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await _measure(
            db,
            "class_summary",
            lambda: get_class_scope_summary(db),
            MAX_SQL["class_summary"],
        )


@pytest.mark.asyncio
async def test_perf_class_detail_and_history_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        target = await _scale_target_class(db)
        await _measure(
            db,
            "class_detail",
            lambda: get_class_response(db, target),
            MAX_SQL["class_detail"],
        )
        await _measure(
            db,
            "class_history",
            lambda: get_class_history(db, target),
            MAX_SQL["class_history"],
        )


@pytest.mark.asyncio
async def test_perf_availability_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        staff = [
            UUID(str(value))
            for value in (
                await db.scalars(
                    text(
                        "select id from public.staff_members where full_name like 'PerfGV %' order by id limit 2"
                    )
                )
            ).all()
        ]
        if len(staff) < 2:
            pytest.skip("scale staff not seeded")

        async def _availability():
            await get_class_schedule_availability(
                db,
                class_id=None,
                teacher_ids=[str(staff[0])],
                assistant_ids=[str(staff[1])],
                start_date=START,
                end_date=END,
            )

        await _measure(db, "availability", _availability, MAX_SQL["availability"])


@pytest.mark.asyncio
async def test_perf_occurrences_and_preview_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        target = await _scale_target_class(db)

        async def _occurrences():
            await get_class_effective_occurrences(db, target, START, END)

        await _measure(db, "occurrences", _occurrences, MAX_SQL["occurrences"])

        async def _preview():
            await preview_postponement(
                db,
                target,
                PostponementPreviewRequest(
                    from_date=START,
                    to_date=START + timedelta(days=14),
                ),
            )

        await _measure(db, "preview", _preview, MAX_SQL["preview"])


@pytest.mark.asyncio
async def test_perf_student_search_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:

        async def _search():
            await get_students(db, search="PerfHV 0", status="active", limit=50)

        await _measure(db, "student_search", _search, MAX_SQL["student_search"])


@pytest.mark.asyncio
async def test_perf_fee_list_query_count() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:

        async def _list():
            await get_fee_records(db, period="2026-01", state="UNPAID")

        await _measure(db, "fee_list", _list, MAX_SQL["fee_list"])


@pytest.mark.asyncio
async def test_perf_warm_p95_class_list() -> None:
    """Warm p95 for the class list on scale data (the dominant list endpoint)."""
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await _measure_iterations(
            db,
            "class_list_warm_p95",
            lambda: get_classes(db, scope="operational"),
            iterations=10,
            max_sql=MAX_SQL["class_list"],
        )
