"""R6-D07/V07 — stable schedule slot identity integration tests.

Run with RUN_DB_INTEGRATION=1. Proves: JSON→slot backfill 1:1; slot UUID is
stable across time edits (version bumps); closing a slot keeps history;
occurrence identity carries slot_id/version; makeup/preview read relational
slots.
"""

import os
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.core.database import AsyncSessionLocal
from app.schemas.class_ import ClassCreate
from app.services.class_service import create_class, update_class
from app.schemas.class_ import ClassUpdate
from app.services.schedule_slot_service import load_class_slots

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
            "zalo": f"slot {staff_id[:8]}",
            "phone": phone,
        },
    )


def _payload(teacher_id: str, slots: list[dict]) -> ClassCreate:
    from datetime import timedelta

    start = business_today() + timedelta(days=1)
    return ClassCreate(
        name=f"SLOT CLASS {uuid4().hex[:6]}",
        type="MONTHLY",
        base_fee=750_000,
        billing_cycle_months=1,
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=2026,
        start_date=start,
        end_date=start.replace(year=start.year + 1),
        identity_scheme="ACADEMIC_YEAR",
        schedule={"text": "T2/T3", "slots": slots},
        teacher_ids=[teacher_id],
    )


async def test_create_class_dual_writes_relational_slots() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV SLOT", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _payload(
                teacher_id,
                [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    }
                ],
            ),
            actor_user_id=None,
        )
        slots = await load_class_slots(db, str(created.id))
        assert len(slots) == 1
        assert slots[0]["day"] == "Thứ 2"
        assert slots[0]["slot_id"]
        assert slots[0]["version"] == 1
        assert slots[0]["teacher_ids"] == [teacher_id]


async def test_edit_hours_keeps_uuid_and_bumps_version() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV SLOT EDIT", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _payload(
                teacher_id,
                [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    }
                ],
            ),
            actor_user_id=None,
        )
        slot_id = (await load_class_slots(db, str(created.id)))[0]["slot_id"]

        # Sửa giờ: giữ UUID, version 2.
        await update_class(
            db,
            UUID(str(created.id)),
            ClassUpdate(
                expected_version=created.version,
                schedule={
                    "text": "T2 mới",
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "19:00",
                            "end": "20:30",
                            "teacher_ids": [teacher_id],
                            "assistant_ids": [],
                        }
                    ],
                },
            ),
            actor_user_id=None,
        )
        slots = await load_class_slots(db, str(created.id))
        assert len(slots) == 1
        assert slots[0]["slot_id"] == slot_id
        assert slots[0]["version"] == 2
        assert slots[0]["start"] == "19:00"


async def test_removed_slot_is_closed_not_deleted() -> None:
    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV SLOT CLOSE", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _payload(
                teacher_id,
                [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    },
                    {
                        "day": "Thứ 3",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    },
                ],
            ),
            actor_user_id=None,
        )
        before = await load_class_slots(db, str(created.id))
        assert len(before) == 2
        thursday_slot_id = next(
            slot["slot_id"] for slot in before if slot["day"] == "Thứ 3"
        )

        await update_class(
            db,
            UUID(str(created.id)),
            ClassUpdate(
                expected_version=created.version,
                schedule={
                    "text": "chỉ T2",
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
            ),
            actor_user_id=None,
        )
        # Slot Thứ 3 đóng effective range, không bị xóa.
        row = (
            await db.execute(
                text(
                    "select effective_until from public.class_schedule_slots "
                    "where id = :id"
                ),
                {"id": thursday_slot_id},
            )
        ).one()
        assert row.effective_until is not None
        assert row.effective_until <= business_today()
        # Chỉ slot đang hiệu lực xuất hiện trong projection.
        active = await load_class_slots(db, str(created.id))
        assert [slot["day"] for slot in active] == ["Thứ 2"]


async def test_occurrences_carry_slot_identity() -> None:
    from datetime import timedelta

    from app.core.occurrence import expand_weekly_occurrences

    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV SLOT OCC", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _payload(
                teacher_id,
                [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    }
                ],
            ),
            actor_user_id=None,
        )
        slots = await load_class_slots(db, str(created.id))
        slot_id = slots[0]["slot_id"]

        monday = business_today() + timedelta(days=(7 - business_today().weekday()) % 7)
        start_window = datetime.combine(
            monday, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
        )
        occurrences = expand_weekly_occurrences(
            class_id=str(created.id),
            schedule={"slots": slots},
            start_date=created.start_date,
            end_date=created.end_date,
            range_start=start_window,
            range_end=start_window + timedelta(days=7),
        )
        assert occurrences
        assert all(item.source_slot_id == slot_id for item in occurrences)
        assert all(item.slot_version == 1 for item in occurrences)
        assert all(item.source_slot_key for item in occurrences)


async def test_makeup_preview_reads_relational_slots() -> None:
    from datetime import timedelta

    from app.schemas.makeup import PostponementPreviewRequest
    from app.services.class_makeup_service import preview_postponement

    async with AsyncSessionLocal() as db:
        teacher_id = str(uuid4())
        await _make_staff(db, teacher_id, "GV SLOT MK", "TEACHER")
        await db.commit()
        created = await create_class(
            db,
            _payload(
                teacher_id,
                [
                    {
                        "day": "Thứ 2",
                        "start": "18:00",
                        "end": "19:30",
                        "teacher_ids": [teacher_id],
                        "assistant_ids": [],
                    }
                ],
            ),
            actor_user_id=None,
        )
        monday = business_today() + timedelta(days=(7 - business_today().weekday()) % 7)
        preview = await preview_postponement(
            db,
            UUID(str(created.id)),
            PostponementPreviewRequest(
                from_date=monday,
                to_date=monday + timedelta(days=6),
            ),
        )
        assert len(preview.occurrences) == 1
        assert preview.occurrences[0].source_slot_key
