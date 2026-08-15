"""R6-D01/V01 — class end-date contract integration tests (disposable DB).

Run with RUN_DB_INTEGRATION=1 against a migrated disposable PostgreSQL.
Proves: cadence-independent dates, preview impact counts + fingerprint, stale
version/fingerprint -> conflict with zero mutation, start immutability and
concurrent edit safety.
"""

import asyncio
import os
from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.business_time import business_today
from app.schemas.class_ import (
    ClassEndDatePreviewRequest,
    ClassEndDateUpdate,
    ClassCreate,
    ClassUpdate,
)
from app.services.class_service import (
    create_class,
    preview_class_end_date,
    update_class,
    update_class_end_date,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def _make_staff(db, staff_id: str, name: str, staff_type: str) -> None:
    phone = f"09{int(staff_id[:8], 16) % 100000000:08d}"
    await db.execute(
        text(
            """
            insert into public.staff_members
              (id, full_name, staff_type, zalo_name, phone, is_active)
            values
              (cast(:id as uuid), :name, :staff_type, :zalo, :phone, true)
            """
        ),
        {
            "id": staff_id,
            "name": name,
            "staff_type": staff_type,
            "zalo": f"enddate {staff_id[:8]}",
            "phone": phone,
        },
    )


def _class_payload(
    *,
    class_type: str,
    start_date: date,
    end_date: date,
    billing_cycle_weeks: int | None,
    teacher_id: UUID,
) -> ClassCreate:
    return ClassCreate(
        name=f"END-DATE {class_type} {uuid4().hex[:6]}",
        type=class_type,  # type: ignore[arg-type]
        base_fee=750000,
        billing_cycle_months=1,
        billing_cycle_weeks=billing_cycle_weeks,
        start_date=start_date,
        end_date=end_date,
        identity_scheme="ACADEMIC_YEAR",
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=start_date.year,
        schedule={
            "text": "T2",
            "slots": [
                {
                    "day": "Thứ 2",
                    "start": "18:00",
                    "end": "19:30",
                    "teacher_ids": [teacher_id],
                    "assistant_ids": [],
                }
            ],
        },
        teacher_ids=[teacher_id],
    )


async def test_monthly_end_date_not_divisible_is_accepted() -> None:
    """R6: monthly end dates no longer need to divide cadence."""
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV END MONTHLY", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        target_end = start + timedelta(days=8)
        payload = _class_payload(
            class_type="MONTHLY",
            start_date=start,
            end_date=target_end,
            billing_cycle_weeks=None,
            teacher_id=UUID(teacher_id),
        )
        created = await create_class(db, payload)
        assert created.end_date == target_end


async def test_course_end_date_shorter_than_package_is_accepted() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV END COURSE", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        created = await create_class(
            db,
            _class_payload(
                class_type="COURSE",
                start_date=start,
                end_date=start + timedelta(days=1),
                billing_cycle_weeks=3,
                teacher_id=UUID(teacher_id),
            ),
        )
        assert created.end_date == start + timedelta(days=1)


async def test_preview_update_fingerprint_and_stale_conflict() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV END PREVIEW", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        target_end = start + timedelta(days=1)
        created = await create_class(
            db,
            _class_payload(
                class_type="COURSE",
                start_date=start,
                end_date=start + timedelta(weeks=12),
                billing_cycle_weeks=3,
                teacher_id=UUID(teacher_id),
            ),
        )
        class_id = UUID(str(created.id))
        original_version = created.version

        # Preview returns impact/version/fingerprint + expiry for any date after start.
        preview = await preview_class_end_date(
            db,
            class_id,
            ClassEndDatePreviewRequest(
                end_date=target_end,
                expected_version=original_version,
            ),
        )
        assert preview is not None
        assert preview.version == original_version
        assert len(preview.preview_fingerprint) == 64
        assert preview.preview_expires_at is not None

        # End equal to start remains invalid even without a billing minimum.
        with pytest.raises(ValueError) as exc_info:
            await preview_class_end_date(
                db,
                class_id,
                ClassEndDatePreviewRequest(
                    end_date=start,
                    expected_version=original_version,
                ),
            )
        assert "sau ngày bắt đầu" in str(exc_info.value)

        # fingerprint sai -> conflict 409, zero mutation
        with pytest.raises(ValueError) as exc_info:
            await update_class_end_date(
                db,
                class_id,
                ClassEndDateUpdate(
                    end_date=target_end,
                    reason="Rút ngắn theo kế hoạch trung tâm",
                    expected_version=original_version,
                    expected_fingerprint="0" * 64,
                ),
                actor_user_id=None,
            )
        assert "vừa được cập nhật" in str(exc_info.value)

        # version sai -> conflict
        with pytest.raises(ValueError) as exc_info:
            await update_class_end_date(
                db,
                class_id,
                ClassEndDateUpdate(
                    end_date=target_end,
                    reason="Rút ngắn theo kế hoạch trung tâm",
                    expected_version=original_version + 99,
                    expected_fingerprint=preview.preview_fingerprint,
                ),
                actor_user_id=None,
            )
        assert "vừa được cập nhật" in str(exc_info.value)

        # fingerprint + version đúng -> thành công, end thay đổi
        updated = await update_class_end_date(
            db,
            class_id,
            ClassEndDateUpdate(
                end_date=target_end,
                reason="Rút ngắn theo kế hoạch trung tâm",
                expected_version=original_version,
                expected_fingerprint=preview.preview_fingerprint,
            ),
            actor_user_id=None,
        )
        assert updated is not None
        assert updated.end_date == target_end
        assert updated.version == original_version + 1
        # start bất biến
        assert updated.start_date == start


async def test_start_date_update_rejected_by_service() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV START LOCK", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        created = await create_class(
            db,
            _class_payload(
                class_type="MONTHLY",
                start_date=start,
                end_date=start + timedelta(days=150),
                billing_cycle_weeks=None,
                teacher_id=UUID(teacher_id),
            ),
        )
        class_id = UUID(str(created.id))
        with pytest.raises(ValueError) as exc_info:
            await update_class(
                db,
                class_id,
                ClassUpdate(
                    start_date=start + timedelta(days=1),
                    end_date_change_reason="không hợp lệ",
                    expected_version=created.version,
                ),
            )
        assert "cố định" in str(exc_info.value)


async def test_patch_path_requires_preview_fingerprint() -> None:
    """PATCH /classes/{id} with an end-date change must also honour the
    preview fingerprint contract (TOCTOU protection on the generic path)."""
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV PATCH FP", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        original_end = start + timedelta(days=150)
        target_end = start + timedelta(days=120)
        created = await create_class(
            db,
            _class_payload(
                class_type="MONTHLY",
                start_date=start,
                end_date=original_end,
                billing_cycle_weeks=None,
                teacher_id=UUID(teacher_id),
            ),
        )
        class_id = UUID(str(created.id))
        original_version = created.version
        # Thiếu fingerprint -> conflict, zero mutation
        with pytest.raises(ValueError) as exc_info:
            await update_class(
                db,
                class_id,
                ClassUpdate(
                    end_date=target_end,
                    end_date_change_reason="Rút ngắn theo kế hoạch",
                    expected_version=original_version,
                ),
            )
        assert "vừa được cập nhật" in str(exc_info.value)

        # Fingerprint sai -> conflict
        preview = await preview_class_end_date(
            db,
            class_id,
            ClassEndDatePreviewRequest(
                end_date=target_end,
                expected_version=original_version,
            ),
        )
        assert preview is not None
        with pytest.raises(ValueError) as exc_info:
            await update_class(
                db,
                class_id,
                ClassUpdate(
                    end_date=target_end,
                    end_date_change_reason="Rút ngắn theo kế hoạch",
                    expected_version=original_version,
                    expected_fingerprint="0" * 64,
                ),
            )
        assert "vừa được cập nhật" in str(exc_info.value)

        # Fingerprint đúng -> thành công
        updated = await update_class(
            db,
            class_id,
            ClassUpdate(
                end_date=target_end,
                end_date_change_reason="Rút ngắn theo kế hoạch",
                expected_version=original_version,
                expected_fingerprint=preview.preview_fingerprint,
            ),
        )
        assert updated is not None
        assert updated.end_date == target_end
        assert updated.version == original_version + 1


async def test_concurrent_end_date_edits_only_one_wins() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV CONC END", "TEACHER")
        await db.commit()
        start = business_today() + timedelta(days=1)
        created = await create_class(
            db,
            _class_payload(
                class_type="MONTHLY",
                start_date=start,
                end_date=start + timedelta(days=150),
                billing_cycle_weeks=None,
                teacher_id=UUID(teacher_id),
            ),
        )
        class_id = str(created.id)

    async def attempt(target_end: date) -> str:
        async with AsyncSessionLocal() as session:
            class_row = await session.scalar(
                text("select version from public.classes where id = :id"),
                {"id": class_id},
            )
            version = int(class_row)
            preview = await preview_class_end_date(
                session,
                UUID(class_id),
                ClassEndDatePreviewRequest(
                    end_date=target_end, expected_version=version
                ),
            )
            assert preview is not None
            try:
                await update_class_end_date(
                    session,
                    UUID(class_id),
                    ClassEndDateUpdate(
                        end_date=target_end,
                        reason="Điều chỉnh đồng thời",
                        expected_version=version,
                        expected_fingerprint=preview.preview_fingerprint,
                    ),
                    actor_user_id=None,
                )
                return "committed"
            except ValueError:
                return "conflict"

    results = await asyncio.gather(
        attempt(start + timedelta(days=110)),
        attempt(start + timedelta(days=120)),
        attempt(start + timedelta(days=130)),
    )
    assert results.count("committed") == 1
    assert results.count("conflict") == 2
