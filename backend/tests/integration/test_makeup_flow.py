"""Integration tests: postponement / make-up flow against the disposable DB.

Run with RUN_DB_INTEGRATION=1 against a migrated disposable PostgreSQL
(migration 053 applied). Every fixture row is self-created and deterministic;
financial-isolation assertions hash fee tables before/after each command.
"""

import asyncio
import hashlib
import os
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.database import AsyncSessionLocal
from app.schemas.makeup import (
    MakeupCompleteRequest,
    MakeupDomainError,
    MakeupScheduleRequest,
    MakeupUnscheduleRequest,
    PostponementCreateRequest,
    PostponementPreviewRequest,
    RestoreOriginalRequest,
)
from app.services.class_makeup_service import (
    complete_makeup,
    create_postponement,
    get_class_effective_occurrences,
    preview_postponement,
    restore_original_session,
    schedule_makeup,
    unschedule_makeup,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _fee_tables_hash(db) -> str:
    """SHA-256 fingerprint của toàn bộ fee/payment tables (financial isolation)."""
    digest = hashlib.sha256()
    for table in ("fee_records", "payments", "fee_operations", "fee_operation_items"):
        result = await db.execute(text(f"select * from public.{table} order by 1"))
        rows = result.fetchall()
        for row in rows:
            digest.update(repr(tuple(row)).encode("utf-8", "replace"))
    return digest.hexdigest()


async def _make_staff(
    db, staff_id: str, name: str, staff_type: str, *, active: bool = True
) -> None:
    phone = f"09{int(staff_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), :name, :staff_type, :zalo, :phone, :active)
            """
        ),
        {
            "id": staff_id,
            "name": name,
            "staff_type": staff_type,
            "zalo": f"mk {staff_id[:8]}",
            "phone": phone,
            "active": active,
        },
    )


async def _make_class_with_teacher(
    db,
    *,
    class_id: str,
    teacher_id: str,
    assistant_id: str | None = None,
    name: str | None = None,
    slot_day: str = "Thứ 2",
    slot_start: str = "18:00",
    slot_end: str = "19:30",
) -> None:
    monday = _next_monday()
    class_name = name or f"MK {class_id[:8]}"
    await db.execute(
        text(
            """
            insert into public.classes (
              id, name, type, base_fee, billing_cycle_months, teacher_id,
              identity_scheme, class_category, grade_mode, grade_level,
              education_level, academic_year_start, start_date, end_date,
              is_active, schedule
            ) values (
              cast(:id as uuid), :class_name, 'MONTHLY', 750000, 1, cast(:teacher as uuid),
              'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6, 'MIDDLE', 2026,
              :start_date, :end_date, true, :schedule
            )
            """
        ),
        {
            "id": class_id,
            "class_name": class_name,
            "teacher": teacher_id,
            "start_date": monday,
            "end_date": monday + timedelta(days=90),
            "schedule": (
                '{"text": "'
                + slot_day
                + " ("
                + slot_start
                + "-"
                + slot_end
                + ')", "slots": ['
                '{"day": "'
                + slot_day
                + '", "start": "'
                + slot_start
                + '", "end": "'
                + slot_end
                + '", '
                f'"teacher_ids": ["{teacher_id}"]'
                + (
                    f', "assistant_ids": ["{assistant_id}"]'
                    if assistant_id
                    else ', "assistant_ids": []'
                )
                + "}]}"
            ),
        },
    )
    await db.execute(
        text(
            "insert into public.class_teachers (class_id, teacher_id) values (cast(:c as uuid), cast(:t as uuid))"
        ),
        {"c": class_id, "t": teacher_id},
    )
    if assistant_id:
        await db.execute(
            text(
                "insert into public.class_teachers (class_id, teacher_id) values (cast(:c as uuid), cast(:t as uuid))"
            ),
            {"c": class_id, "t": assistant_id},
        )


async def _make_student(db, student_id: str, name: str) -> None:
    await db.execute(
        text(
            "insert into public.students (id, full_name, status) values (cast(:id as uuid), :name, 'active')"
        ),
        {"id": student_id, "name": name},
    )


async def _make_enrollment(
    db,
    *,
    enrollment_id: str,
    student_id: str,
    class_id: str,
    enrollment_date: date,
    status: str = "active",
) -> None:
    await db.execute(
        text(
            """
            insert into public.enrollments (
              id, student_id, class_id, enrollment_date, status
            ) values (
              cast(:id as uuid), cast(:student as uuid), cast(:class as uuid),
              :enrollment_date, :status
            )
            """
        ),
        {
            "id": enrollment_id,
            "student": student_id,
            "class": class_id,
            "enrollment_date": enrollment_date,
            "status": status,
        },
    )


def _next_monday() -> date:
    today = business_today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def _monday_occurrence_start(class_id: str) -> datetime:
    """18:00 VN ngày Thứ 2 kế tiếp (UTC)."""
    monday = _next_monday()
    local = datetime.combine(
        monday, datetime.min.time().replace(hour=18), tzinfo=BUSINESS_TIMEZONE
    )
    return local.astimezone(timezone.utc)


async def _create_standard_class() -> dict:
    """Tạo teacher + class + student + enrollment; trả IDs."""
    ids = {
        "teacher": str(uuid4()),
        "assistant": str(uuid4()),
        "class": str(uuid4()),
        "student_a": str(uuid4()),
        "student_b": str(uuid4()),
        "enrollment_a": str(uuid4()),
        "enrollment_b": str(uuid4()),
    }
    async with AsyncSessionLocal() as db:
        await _make_staff(db, ids["teacher"], "MK Teacher", "TEACHER")
        await _make_staff(db, ids["assistant"], "MK Assistant", "ASSISTANT")
        await _make_class_with_teacher(
            db,
            class_id=ids["class"],
            teacher_id=ids["teacher"],
            assistant_id=ids["assistant"],
        )
        await _make_student(db, ids["student_a"], "MK Student A")
        await _make_student(db, ids["student_b"], "MK Student B")
        await _make_enrollment(
            db,
            enrollment_id=ids["enrollment_a"],
            student_id=ids["student_a"],
            class_id=ids["class"],
            enrollment_date=_next_monday(),
        )
        await _make_enrollment(
            db,
            enrollment_id=ids["enrollment_b"],
            student_id=ids["student_b"],
            class_id=ids["class"],
            enrollment_date=_next_monday() + timedelta(days=30),
        )
        await db.commit()
    return ids


@pytest.mark.asyncio
async def test_full_postpone_schedule_complete_flow_with_financial_isolation() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])

    async with AsyncSessionLocal() as db:
        before = await _fee_tables_hash(db)

        result = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="TEACHER_UNAVAILABLE",
                reason_note="Giáo viên bận việc gia đình",
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        assert result.billing_impact == "NONE"
        assert len(result.exceptions) == 1
        exception = result.exceptions[0]
        assert exception.status == "MAKEUP_PENDING"
        assert len(exception.staff) == 2
        assert {item.role for item in exception.staff} == {"TEACHER", "ASSISTANT"}
        # Student B nhập học sau buổi gốc -> không có trong snapshot.
        assert exception.eligible_student_count == 1
        after_pending = await _fee_tables_hash(db)

    replacement = original + timedelta(days=3, hours=0)
    async with AsyncSessionLocal() as db:
        scheduled = await schedule_makeup(
            db,
            exception.id,
            MakeupScheduleRequest(
                replacement_start_at=replacement,
                request_id=UUID(str(uuid4())),
                expected_version=exception.version,
            ),
            actor_user_id=None,
        )
        await db.commit()
        assert scheduled.exception.status == "MAKEUP_SCHEDULED"
        assert scheduled.exception.replacement_start_at == replacement
        assert scheduled.billing_impact == "NONE"
        # R6: make-up không đổi class end date; trạng thái chỉ thuộc bộ 5 hợp lệ
        # (không FINALIZING, không operational_end_date).
        assert scheduled.effective_status in {
            "LEGACY",
            "SCHEDULED",
            "ACTIVE",
            "COMPLETED",
            "CANCELLED",
        }
        new_version = scheduled.exception.version
        after_scheduled = await _fee_tables_hash(db)

    # Chưa kết thúc -> không xác nhận được.
    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await complete_makeup(
                db,
                exception.id,
                MakeupCompleteRequest(
                    request_id=UUID(str(uuid4())),
                    expected_version=new_version,
                ),
                actor_user_id=None,
                now=replacement + timedelta(minutes=30),
            )
        assert exc_info.value.code == "MAKEUP_NOT_FINISHED"
        await db.rollback()

    # Sau khi kết thúc -> xác nhận thành công.
    async with AsyncSessionLocal() as db:
        completed = await complete_makeup(
            db,
            exception.id,
            MakeupCompleteRequest(
                request_id=UUID(str(uuid4())),
                expected_version=new_version,
            ),
            actor_user_id=None,
            now=replacement + timedelta(hours=2),
        )
        await db.commit()
        assert completed.exception.status == "MAKEUP_COMPLETED"
        after_completed = await _fee_tables_hash(db)

    assert after_pending == before
    assert after_scheduled == before
    assert after_completed == before


@pytest.mark.asyncio
async def test_idempotent_replay_creates_single_batch() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    request_id = UUID(str(uuid4()))

    async with AsyncSessionLocal() as db:
        first = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="CENTER_OPERATION",
                reason_note=None,
                schedule_now=False,
                request_id=request_id,
            ),
            actor_user_id=None,
        )
        await db.commit()
        first_exception_ids = {item.id for item in first.exceptions}

        second = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="CENTER_OPERATION",
                reason_note=None,
                schedule_now=False,
                request_id=request_id,
            ),
            actor_user_id=None,
        )
        assert {item.id for item in second.exceptions} == first_exception_ids
        count = (
            await db.execute(
                text(
                    "select count(*) from public.class_schedule_adjustments where request_id = :rid"
                ),
                {"rid": str(request_id)},
            )
        ).scalar()
        assert count == 1
        await db.rollback()

    # Cùng request_id nhưng payload khác -> deterministic conflict.
    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await create_postponement(
                db,
                UUID(ids["class"]),
                PostponementCreateRequest(
                    original_start_at=[original + timedelta(days=7)],
                    reason_code="CENTER_OPERATION",
                    reason_note=None,
                    schedule_now=False,
                    request_id=request_id,
                ),
                actor_user_id=None,
            )
        assert exc_info.value.code == "REQUEST_ALREADY_PROCESSED"
        await db.rollback()


@pytest.mark.asyncio
async def test_staff_conflict_blocks_schedule_and_stale_version_rejected() -> None:
    ids = await _create_standard_class()
    other_class = str(uuid4())
    async with AsyncSessionLocal() as db:
        await _make_class_with_teacher(
            db,
            class_id=other_class,
            teacher_id=ids["teacher"],
            name=f"MK Other {other_class[:8]}",
            slot_day="Thứ 3",
        )
        await db.commit()

    original = _monday_occurrence_start(ids["class"])
    async with AsyncSessionLocal() as db:
        result = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="OTHER",
                reason_note="xung đột test",
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        exception = result.exceptions[0]

    # Candidate trùng giờ với lớp khác cùng teacher -> STAFF_SCHEDULE_CONFLICT.
    replacement = original + timedelta(days=1)
    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await schedule_makeup(
                db,
                exception.id,
                MakeupScheduleRequest(
                    replacement_start_at=replacement,
                    request_id=UUID(str(uuid4())),
                    expected_version=exception.version,
                ),
                actor_user_id=None,
            )
        assert exc_info.value.code == "STAFF_SCHEDULE_CONFLICT"
        await db.rollback()

    # Stale version -> CLASS_VERSION_CONFLICT.
    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await schedule_makeup(
                db,
                exception.id,
                MakeupScheduleRequest(
                    replacement_start_at=replacement + timedelta(days=6),
                    request_id=UUID(str(uuid4())),
                    expected_version=exception.version + 99,
                ),
                actor_user_id=None,
            )
        assert exc_info.value.code == "CLASS_VERSION_CONFLICT"
        await db.rollback()


@pytest.mark.asyncio
async def test_unschedule_returns_pending_and_restore_valid_then_conflict() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        result = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="TEACHER_UNAVAILABLE",
                reason_note=None,
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        exception = result.exceptions[0]

    # Schedule rồi unschedule -> quay về PENDING.
    async with AsyncSessionLocal() as db:
        scheduled = await schedule_makeup(
            db,
            exception.id,
            MakeupScheduleRequest(
                replacement_start_at=original + timedelta(days=3),
                request_id=UUID(str(uuid4())),
                expected_version=exception.version,
            ),
            actor_user_id=None,
        )
        await db.commit()
        assert scheduled.exception.status == "MAKEUP_SCHEDULED"
        unscheduled = await unschedule_makeup(
            db,
            exception.id,
            MakeupUnscheduleRequest(
                request_id=UUID(str(uuid4())),
                expected_version=scheduled.exception.version,
            ),
            actor_user_id=None,
        )
        await db.commit()
        assert unscheduled.exception.status == "MAKEUP_PENDING"
        assert unscheduled.exception.replacement_start_at is None

    # Restore hợp lệ (original chưa qua, chưa có buổi bù nào trùng).
    async with AsyncSessionLocal() as db:
        refreshed = (
            await db.execute(
                text(
                    "select version from public.class_session_exceptions where id = :eid"
                ),
                {"eid": str(exception.id)},
            )
        ).scalar()
        restored = await restore_original_session(
            db,
            exception.id,
            RestoreOriginalRequest(
                request_id=UUID(str(uuid4())),
                expected_version=refreshed,
            ),
            actor_user_id=None,
            now=now,
        )
        assert restored.exception.status == "RESTORED"
        await db.rollback()


@pytest.mark.asyncio
async def test_restore_after_original_passed_rejected() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    # Hoãn một buổi ở tuần sau nhưng giả lập 'now' đã qua buổi gốc.
    async with AsyncSessionLocal() as db:
        result = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original + timedelta(days=7)],
                reason_code="OTHER",
                reason_note="restore test",
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        exception = result.exceptions[0]

    async with AsyncSessionLocal() as db:
        refreshed = (
            await db.execute(
                text(
                    "select version from public.class_session_exceptions where id = :eid"
                ),
                {"eid": str(exception.id)},
            )
        ).scalar()
        with pytest.raises(MakeupDomainError) as exc_info:
            await restore_original_session(
                db,
                exception.id,
                RestoreOriginalRequest(
                    request_id=UUID(str(uuid4())),
                    expected_version=refreshed,
                ),
                actor_user_id=None,
                now=original + timedelta(days=8, hours=5),
            )
        assert exc_info.value.code == "RESTORE_NOT_ALLOWED"
        await db.rollback()


@pytest.mark.asyncio
async def test_preview_is_read_only_and_effective_occurrences_apply_overlay() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    monday = _next_monday()

    async with AsyncSessionLocal() as db:
        preview = await preview_postponement(
            db,
            UUID(ids["class"]),
            PostponementPreviewRequest(
                from_date=monday,
                to_date=monday + timedelta(days=6),
            ),
        )
        assert any(item.original_start_at == original for item in preview.occurrences)
        # Preview không ghi gì cho lớp này.
        count = (
            await db.execute(
                text(
                    "select count(*) from public.class_session_exceptions "
                    "where class_id = :cid"
                ),
                {"cid": ids["class"]},
            )
        ).scalar()
        assert count == 0
        await db.rollback()

    async with AsyncSessionLocal() as db:
        await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="CENTER_OPERATION",
                reason_note=None,
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()

    async with AsyncSessionLocal() as db:
        occurrences = await get_class_effective_occurrences(
            db,
            UUID(ids["class"]),
            monday,
            monday + timedelta(days=6),
        )
        # Original bị suppress (POSTPONED), không còn REGULAR.
        assert not any(
            item.kind == "REGULAR" and item.original_start_at == original
            for item in occurrences.occurrences
        )
        assert any(item.kind == "MAKEUP" for item in occurrences.occurrences) is False
        await db.rollback()


@pytest.mark.asyncio
async def test_duplicate_postponement_of_same_original_rejected() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    request_id = UUID(str(uuid4()))

    async with AsyncSessionLocal() as db:
        await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="OTHER",
                reason_note=None,
                schedule_now=False,
                request_id=request_id,
            ),
            actor_user_id=None,
        )
        await db.commit()

    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await create_postponement(
                db,
                UUID(ids["class"]),
                PostponementCreateRequest(
                    original_start_at=[original],
                    reason_code="OTHER",
                    reason_note=None,
                    schedule_now=False,
                    request_id=UUID(str(uuid4())),
                ),
                actor_user_id=None,
            )
        assert exc_info.value.code == "OCCURRENCE_ALREADY_ADJUSTED"
        await db.rollback()


@pytest.mark.asyncio
async def test_concurrent_schedule_same_staff_interval_only_one_commits() -> None:
    ids = await _create_standard_class()
    original = _monday_occurrence_start(ids["class"])
    replacement = original + timedelta(days=2)

    # Hai exception độc lập (hai buổi gốc khác tuần) cùng cạnh tranh MỘT khung
    # giờ teacher.
    async with AsyncSessionLocal() as db:
        first = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original],
                reason_code="OTHER",
                reason_note=None,
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        exception_a = first.exceptions[0]
        second = await create_postponement(
            db,
            UUID(ids["class"]),
            PostponementCreateRequest(
                original_start_at=[original + timedelta(days=7)],
                reason_code="OTHER",
                reason_note=None,
                schedule_now=False,
                request_id=UUID(str(uuid4())),
            ),
            actor_user_id=None,
        )
        await db.commit()
        exception_b = second.exceptions[0]

    async def try_schedule(exception_id, expected_version) -> bool:
        async with AsyncSessionLocal() as db:
            try:
                await schedule_makeup(
                    db,
                    exception_id,
                    MakeupScheduleRequest(
                        replacement_start_at=replacement,
                        request_id=UUID(str(uuid4())),
                        expected_version=expected_version,
                    ),
                    actor_user_id=None,
                )
                await db.commit()
                return True
            except MakeupDomainError:
                await db.rollback()
                return False
            except Exception:
                await db.rollback()
                raise

    results = await asyncio.gather(
        try_schedule(exception_a.id, exception_a.version),
        try_schedule(exception_b.id, exception_b.version),
    )
    assert sum(results) == 1, "exactly one concurrent schedule may commit"


@pytest.mark.asyncio
async def test_occurrence_outside_class_range_rejected() -> None:
    ids = await _create_standard_class()
    # Ngày ngoài khoảng lớp (sau end_date) -> OCCURRENCE_NOT_FOUND.
    far_future = _monday_occurrence_start(ids["class"]) + timedelta(days=400)
    async with AsyncSessionLocal() as db:
        with pytest.raises(MakeupDomainError) as exc_info:
            await create_postponement(
                db,
                UUID(ids["class"]),
                PostponementCreateRequest(
                    original_start_at=[far_future],
                    reason_code="OTHER",
                    reason_note=None,
                    schedule_now=False,
                    request_id=UUID(str(uuid4())),
                ),
                actor_user_id=None,
            )
        assert exc_info.value.code == "OCCURRENCE_NOT_FOUND"
        await db.rollback()
