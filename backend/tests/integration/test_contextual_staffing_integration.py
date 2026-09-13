import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.schemas.class_ import ClassCreate, ClassUpdate
from app.schemas.staff import StaffCreate
from app.services.class_service import create_class, get_class_response, update_class
from app.services.staff_service import create_staff_member

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


def _class_payload(
    *,
    name: str,
    day: str,
    start: str,
    end: str,
    staff_id: str | None = None,
    role: str = "TEACHER",
) -> ClassCreate:
    start_date = business_today() + timedelta(days=7)
    teacher_ids = [staff_id] if staff_id and role == "TEACHER" else []
    assistant_ids = [staff_id] if staff_id and role == "ASSISTANT" else []
    return ClassCreate(
        name=name,
        type="MONTHLY",
        base_fee=850_000,
        start_date=start_date,
        identity_scheme="ACADEMIC_YEAR",
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=start_date.year,
        teacher_ids=teacher_ids,
        assistant_ids=assistant_ids,
        schedule={
            "text": f"{day} ({start}-{end})",
            "slots": [
                {
                    "day": day,
                    "start": start,
                    "end": end,
                    "teacher_ids": teacher_ids,
                    "assistant_ids": assistant_ids,
                }
            ],
        },
    )


async def _make_role_neutral_staff(db, label: str):
    suffix = uuid4().hex[:8]
    return await create_staff_member(
        db,
        StaffCreate(
            full_name=f"{label} {suffix}",
            zalo_name=f"Zalo {suffix}",
            phone=f"09{int(suffix, 16) % 100_000_000:08d}",
        ),
    )


async def test_staffless_class_can_be_created_and_assigned_later() -> None:
    async with AsyncSessionLocal() as db:
        created = await create_class(
            db,
            _class_payload(
                name=f"CTX UNASSIGNED {uuid4().hex[:8]}",
                day="Thứ 2",
                start="18:00",
                end="19:30",
            ),
            actor_user_id=None,
        )
        initial = await get_class_response(db, UUID(str(created.id)))
        assert initial is not None
        assert initial.staffing_status == "UNASSIGNED"
        assert len(initial.unassigned_slot_ids) == 1

        staff = await _make_role_neutral_staff(db, "Nhân sự mới")
        assert staff.staff_type is None
        updated = await update_class(
            db,
            UUID(str(created.id)),
            ClassUpdate(
                expected_version=created.version,
                teacher_ids=[UUID(str(staff.id))],
                assistant_ids=[],
                schedule={
                    "text": "Thứ 2 (18:00-19:30)",
                    "slots": [
                        {
                            "day": "Thứ 2",
                            "start": "18:00",
                            "end": "19:30",
                            "teacher_ids": [str(staff.id)],
                            "assistant_ids": [],
                        }
                    ],
                },
            ),
            actor_user_id=None,
        )
        assert updated is not None
        response = await get_class_response(db, UUID(str(created.id)))
        assert response is not None
        assert response.staffing_status == "READY"
        assert response.staff_assignments[0].role == "TEACHER"
        assert len(response.staff_assignments[0].slot_ids) == 1

        revision = (
            await db.execute(
                text(
                    """
                    select role, effective_until
                    from public.class_schedule_slot_staff_revisions
                    where class_id = cast(:class_id as uuid)
                      and staff_id = cast(:staff_id as uuid)
                    order by effective_from desc
                    limit 1
                    """
                ),
                {"class_id": str(created.id), "staff_id": str(staff.id)},
            )
        ).one()
        assert revision.role == "TEACHER"
        assert revision.effective_until is None


async def test_same_staff_can_have_different_roles_in_different_classes() -> None:
    async with AsyncSessionLocal() as db:
        staff = await _make_role_neutral_staff(db, "Nhân sự đa vai trò")
        teacher_class = await create_class(
            db,
            _class_payload(
                name=f"CTX TEACHER {uuid4().hex[:8]}",
                day="Thứ 2",
                start="18:00",
                end="19:30",
                staff_id=str(staff.id),
                role="TEACHER",
            ),
            actor_user_id=None,
        )
        assistant_class = await create_class(
            db,
            _class_payload(
                name=f"CTX ASSISTANT {uuid4().hex[:8]}",
                day="Thứ 4",
                start="18:00",
                end="19:30",
                staff_id=str(staff.id),
                role="ASSISTANT",
            ),
            actor_user_id=None,
        )

        roles = {
            tuple(row)
            for row in (
                await db.execute(
                    text(
                        """
                        select class_id::text, role
                        from public.class_teachers
                        where teacher_id = cast(:staff_id as uuid)
                          and class_id in (
                            cast(:teacher_class as uuid), cast(:assistant_class as uuid)
                          )
                        """
                    ),
                    {
                        "staff_id": str(staff.id),
                        "teacher_class": str(teacher_class.id),
                        "assistant_class": str(assistant_class.id),
                    },
                )
            ).all()
        }
        assert roles == {
            (str(teacher_class.id), "TEACHER"),
            (str(assistant_class.id), "ASSISTANT"),
        }


async def test_cross_role_overlap_is_blocked_for_the_same_staff() -> None:
    async with AsyncSessionLocal() as db:
        staff = await _make_role_neutral_staff(db, "Nhân sự kiểm tra trùng lịch")
        await create_class(
            db,
            _class_payload(
                name=f"CTX BUSY {uuid4().hex[:8]}",
                day="Thứ 3",
                start="18:00",
                end="19:30",
                staff_id=str(staff.id),
                role="ASSISTANT",
            ),
            actor_user_id=None,
        )

        with pytest.raises(ValueError, match="đã có lịch lớp"):
            await create_class(
                db,
                _class_payload(
                    name=f"CTX CONFLICT {uuid4().hex[:8]}",
                    day="Thứ 3",
                    start="18:30",
                    end="20:00",
                    staff_id=str(staff.id),
                    role="TEACHER",
                ),
                actor_user_id=None,
            )
        await db.rollback()
