from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.class_ import (
    ClassCreate,
    StaffAvailabilityPreviewRequest,
)
from app.schemas.staff import StaffCompensationRateCreate, StaffCreate


def _schedule(*, teacher_id=None, assistant_id=None) -> dict:
    return {
        "text": "Thứ 2 (18:00-19:30)",
        "slots": [
            {
                "day": "Thứ 2",
                "start": "18:00",
                "end": "19:30",
                "teacher_ids": [teacher_id] if teacher_id else [],
                "assistant_ids": [assistant_id] if assistant_id else [],
            }
        ],
    }


def test_role_neutral_staff_and_staffless_class_are_valid() -> None:
    staff = StaffCreate(
        full_name="Bảo Ngọc",
        zalo_name="Bảo Ngọc",
        phone="0912345678",
    )
    class_ = ClassCreate(
        name="Lớp nền tảng 12",
        type="MONTHLY",
        base_fee=850_000,
        start_date=date(2026, 9, 7),
        identity_scheme="ACADEMIC_YEAR",
        class_category="GENERAL",
        grade_mode="GRADE",
        grade_level=6,
        academic_year_start=2026,
        schedule=_schedule(),
    )

    assert staff.staff_type is None
    assert class_.teacher_ids == []
    assert class_.schedule is not None
    assert class_.schedule.slots[0].teacher_ids == []


def test_staff_availability_preview_requires_exact_schedule_assignments() -> None:
    staff_id = uuid4()

    with pytest.raises(ValidationError, match="phải khớp phân công"):
        StaffAvailabilityPreviewRequest(
            start_date=date(2026, 9, 7),
            schedule=_schedule(),
            candidate_staff_ids=[staff_id],
        )

    payload = StaffAvailabilityPreviewRequest(
        start_date=date(2026, 9, 7),
        schedule=_schedule(teacher_id=staff_id),
        candidate_staff_ids=[staff_id],
    )
    assert payload.candidate_staff_ids == [staff_id]


def test_same_staff_cannot_hold_two_roles_in_one_class_preview() -> None:
    staff_id = uuid4()
    schedule = {
        "slots": [
            {
                "day": "Thứ 2",
                "start": "18:00",
                "end": "19:30",
                "teacher_ids": [staff_id],
            },
            {
                "day": "Thứ 4",
                "start": "18:00",
                "end": "19:30",
                "assistant_ids": [staff_id],
            },
        ]
    }

    with pytest.raises(ValidationError, match="vừa là giáo viên vừa là trợ giảng"):
        StaffAvailabilityPreviewRequest(
            start_date=date(2026, 9, 7),
            schedule=schedule,
            candidate_staff_ids=[staff_id],
        )


def test_compensation_rate_can_be_scoped_to_contextual_role() -> None:
    default_rate = StaffCompensationRateCreate(
        rate_amount=100_000,
        effective_from=date(2026, 9, 1),
    )
    teacher_rate = StaffCompensationRateCreate(
        rate_amount=150_000,
        assignment_role="TEACHER",
        effective_from=date(2026, 9, 1),
    )

    assert default_rate.assignment_role is None
    assert teacher_rate.assignment_role == "TEACHER"


def test_migration_122_contains_data_safety_and_tenant_guards() -> None:
    sql = (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "122_contextual_class_staff_assignments.sql"
    ).read_text(encoding="utf-8")

    assert "class_teachers alter column role set not null" in sql
    assert "class_schedule_slot_staff_revisions" in sql
    assert "deferrable initially deferred" in sql
    assert "validate_class_slot_staff_revision" in sql
    assert "force row level security" in sql
    assert "assigned staff on an active class cannot be deactivated" in sql
    assert "assignment_role is not distinct from new.assignment_role" in sql
