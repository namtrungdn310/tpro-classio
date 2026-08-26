"""Đo p50/p95/p99 latency của Class-page code paths trên disposable DB.

Chạy đúng code path production trên dataset 100 nhân sự / ~971 lớp:
availability, class list, summary, detail, history, occurrences (overlay),
postponement preview và make-up command. Không dùng cho Supabase thật.
"""

import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.services.class_conflict_service import get_class_schedule_availability
from app.services.class_makeup_service import (
    create_postponement,
    get_class_effective_occurrences,
    preview_postponement,
)
from app.services.class_service import (
    get_class_history,
    get_class_response,
    get_class_scope_summary,
    get_classes,
)
from app.schemas.makeup import PostponementCreateRequest, PostponementPreviewRequest

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://tpro_runtime:disposable@127.0.0.1:55435/tpro_r3",
)
START = date(2026, 9, 1)
END = START + timedelta(days=55)
TARGET_CLASS = "20000000-0000-0000-0000-000000000002"

PROFILE_ID = os.environ.get("PERF_PROFILE_ID", "90000000-0000-0000-0000-000000000001")


def _percentiles(latencies: list[float]) -> tuple[float, float, float]:
    latencies.sort()
    n = len(latencies)
    return (
        latencies[n // 2],
        latencies[int(n * 0.95)],
        latencies[int(n * 0.99)],
    )


def _report(label: str, latencies: list[float]) -> None:
    p50, p95, p99 = _percentiles(latencies)
    print(
        f"{label}: iterations={len(latencies)} "
        f"p50={p50:.2f}ms p95={p95:.2f}ms p99={p99:.2f}ms"
    )


async def main() -> None:
    engine = create_async_engine(DSN, echo=False, pool_size=4)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    loop = asyncio.get_event_loop()

    async with factory() as session:
        rows = (
            (
                await session.execute(
                    __import__("sqlalchemy").text("select id from public.staff_members")
                )
            )
            .scalars()
            .all()
        )
    staff_ids = [str(r) for r in rows]

    # 1. Availability (existing Round-3 contract).
    availability: list[float] = []
    for i in range(200):
        t = staff_ids[(i * 7) % 50 : (i * 7) % 50 + 2]
        a = staff_ids[(i * 13) % 50 : (i * 13) % 50 + 1]
        t0 = loop.time()
        async with factory() as session:
            await get_class_schedule_availability(
                session,
                class_id=None,
                teacher_ids=t,
                assistant_ids=a,
                start_date=START,
                end_date=END,
            )
        availability.append((loop.time() - t0) * 1000)
    _report("availability", availability)

    # 2. Class list by scope (scale: ~650 operational).
    list_latencies: list[float] = []
    for i in range(30):
        scope = ["operational", "active", "scheduled", "completed"][i % 4]
        t0 = loop.time()
        async with factory() as session:
            await get_classes(session, scope=scope)
        list_latencies.append((loop.time() - t0) * 1000)
    _report("class_list", list_latencies)

    # Summary.
    summary_latencies: list[float] = []
    for i in range(20):
        t0 = loop.time()
        async with factory() as session:
            await get_class_scope_summary(session)
        summary_latencies.append((loop.time() - t0) * 1000)
    _report("summary", summary_latencies)

    # Pick a canonical operational class from the scale dataset as the target
    # for detail/history/occurrence/preview measurements.
    async with factory() as session:
        target = (
            await session.execute(
                __import__("sqlalchemy").text(
                    "select id from public.classes "
                    "where identity_scheme <> 'LEGACY' "
                    "  and cancelled_at is null and completed_at is null "
                    "order by id limit 1"
                )
            )
        ).scalar()
    target_class = str(target or TARGET_CLASS)

    # 4. Detail + history.
    detail_latencies: list[float] = []
    history_latencies: list[float] = []
    for i in range(20):
        t0 = loop.time()
        async with factory() as session:
            await get_class_response(session, UUID(target_class))
        detail_latencies.append((loop.time() - t0) * 1000)
        t0 = loop.time()
        async with factory() as session:
            await get_class_history(session, UUID(target_class))
        history_latencies.append((loop.time() - t0) * 1000)
    _report("detail", detail_latencies)
    _report("history", history_latencies)

    # 5. Occurrences (expansion + overlay).
    occurrence_latencies: list[float] = []
    for i in range(20):
        t0 = loop.time()
        async with factory() as session:
            await get_class_effective_occurrences(
                session, UUID(target_class), START, END
            )
        occurrence_latencies.append((loop.time() - t0) * 1000)
    _report("occurrences", occurrence_latencies)

    # 6. Postponement preview (read-only).
    preview_latencies: list[float] = []
    for i in range(20):
        t0 = loop.time()
        async with factory() as session:
            await preview_postponement(
                session,
                UUID(target_class),
                PostponementPreviewRequest(
                    from_date=START,
                    to_date=START + timedelta(days=14),
                ),
            )
        preview_latencies.append((loop.time() - t0) * 1000)
    _report("postpone_preview", preview_latencies)

    # 7. Make-up command (create + schedule) — idempotent per request_id.
    command_latencies: list[float] = []
    if len(staff_ids) >= 1:
        t0 = loop.time()
        async with factory() as session:
            monday = date(2026, 9, 7)
            local = datetime.combine(
                monday, datetime.min.time().replace(hour=18), tzinfo=timezone.utc
            )
            original = local.astimezone(timezone.utc)
            try:
                await create_postponement(
                    session,
                    UUID(target_class),
                    PostponementCreateRequest(
                        original_start_at=[original],
                        reason_code="OTHER",
                        reason_note="perf measure",
                        schedule_now=False,
                        request_id=UUID(str(uuid4())),
                    ),
                    actor_user_id=PROFILE_ID,
                )
                await session.commit()
            except Exception:
                await session.rollback()
        command_latencies.append((loop.time() - t0) * 1000)
    if command_latencies:
        _report("postpone_command", command_latencies)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
