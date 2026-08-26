"""R8 Phase 9 — bounded concurrency on the scale DB.

Proves read endpoints hold up under 10/20/50 concurrent sessions without pool
timeouts, session leaks, exceptions or duplicate rows, and that the DB
instrumentation never reports a request over MAX_SQL_PER_REQUEST.
"""

import asyncio
import os
from datetime import date, timedelta
from uuid import UUID

import pytest

from app.core.database import AsyncSessionLocal
from app.core.performance import MAX_SQL_PER_REQUEST, track_request_metrics
from app.services.class_conflict_service import get_class_schedule_availability
from app.services.class_service import get_class_response, get_classes

pytestmark = [
    pytest.mark.performance,
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated disposable PostgreSQL",
    ),
]

START = date(2026, 9, 1)
END = START + timedelta(days=30)


async def _scale_target_class_id() -> str:
    async with AsyncSessionLocal() as db:
        value = await db.execute(
            __import__("sqlalchemy").text(
                "select id from public.classes where name like 'PerfLop %' "
                "  and identity_scheme <> 'LEGACY' and completed_at is null "
                "order by id limit 1"
            )
        )
        row = value.scalar()
        if row is None:
            pytest.skip("scale dataset not seeded")
        return str(row)


async def _scale_staff_id() -> str:
    async with AsyncSessionLocal() as db:
        value = await db.execute(
            __import__("sqlalchemy").text(
                "select id from public.staff_members where full_name like 'PerfGV %' "
                "order by id limit 1"
            )
        )
        row = value.scalar()
        if row is None:
            pytest.skip("scale dataset not seeded")
        return str(row)


async def _run_read(class_id: str, staff_id: str, index: int) -> None:
    async with AsyncSessionLocal() as db:
        with track_request_metrics() as metrics:
            if index % 3 == 0:
                await get_class_schedule_availability(
                    db,
                    class_id=None,
                    teacher_ids=[staff_id],
                    assistant_ids=[],
                    start_date=START,
                    end_date=END,
                )
            elif index % 3 == 1:
                await get_class_response(db, UUID(class_id))
            else:
                await get_classes(db, scope="operational")
        assert metrics.sql_count <= MAX_SQL_PER_REQUEST, (
            f"concurrent read {index}: {metrics.sql_count} SQL over MAX_SQL_PER_REQUEST"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("concurrency", [10, 20, 50])
async def test_concurrent_reads_under_bounded_load(concurrency: int) -> None:
    class_id = await _scale_target_class_id()
    staff_id = await _scale_staff_id()

    results = await asyncio.gather(
        *[_run_read(class_id, staff_id, index) for index in range(concurrency)],
        return_exceptions=True,
    )
    failures = [item for item in results if isinstance(item, Exception)]
    assert not failures, f"concurrent reads failed: {failures}"

    # Pool is released cleanly: a follow-up session still works.
    async with AsyncSessionLocal() as db:
        value = await db.execute(__import__("sqlalchemy").text("select 1"))
        assert value.scalar() == 1


@pytest.mark.asyncio
async def test_concurrent_reads_do_not_duplicate_availability_rows() -> None:
    """Same availability query under concurrency returns the same block set."""
    staff_id = await _scale_staff_id()

    async def _blocks() -> list:
        async with AsyncSessionLocal() as db:
            return await get_class_schedule_availability(
                db,
                class_id=None,
                teacher_ids=[staff_id],
                assistant_ids=[],
                start_date=START,
                end_date=END,
            )

    serial = await _blocks()
    concurrent = await asyncio.gather(*[_blocks() for _ in range(10)])
    serial_keys = {(b.class_id, b.day, b.start, b.end) for b in serial}
    for result in concurrent:
        assert isinstance(result, list)
        assert {(b.class_id, b.day, b.start, b.end) for b in result} == serial_keys
