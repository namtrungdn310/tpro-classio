from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models.class_ import Class
from app.core.business_time import business_today
from app.schemas.class_ import (
    ClassCreate,
    ClassHistoryTeacherEvent,
    ClassScope,
    ClassUpdate,
)
from app.services.class_service import (
    get_class_labels,
    _synchronize_identity_metadata,
    update_class,
)


def test_class_intake_year_month_is_database_generated() -> None:
    """New classes must let PostgreSQL derive the intake month."""

    assert Class.__table__.c.intake_year_month.computed is not None


def make_class_create(**overrides: object) -> ClassCreate:
    today = business_today()
    payload: dict[str, object] = {
        "name": "6C1",
        "type": "MONTHLY",
        "base_fee": 750_000,
        "billing_cycle_months": 1,
        "identity_scheme": "ACADEMIC_YEAR",
        "class_category": "GENERAL",
        "grade_mode": "GRADE",
        "grade_level": 6,
        "academic_year_start": 2026,
        "start_date": date.fromordinal(today.toordinal() + 1),
        "end_date": date.fromordinal(today.toordinal() + 300),
        "teacher_ids": [uuid4()],
        "schedule": {
            "slots": [
                {"day": "Thứ 2", "start": "18:00", "end": "19:30"},
            ]
        },
    }
    payload.update(overrides)
    if "class_category" not in overrides and payload["identity_scheme"] == "INTAKE":
        payload["class_category"] = "IELTS"
        payload["grade_mode"] = "NONE"
    return ClassCreate(**payload)


def make_persisted_class(**overrides: object) -> Class:
    payload: dict[str, object] = {
        "id": str(uuid4()),
        "name": "IELTS Chuyên sâu",
        "type": "COURSE",
        "base_fee": Decimal("4800000"),
        "billing_cycle_months": 3,
        "billing_cycle_weeks": 12,
        "start_date": business_today(),
        "end_date": business_today() + timedelta(weeks=12),
        "teacher_id": str(uuid4()),
        "is_active": True,
    }
    payload.update(overrides)
    return Class(**payload)


def test_class_scope_rejects_the_internal_legacy_repair_state() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(ClassScope).validate_python("needs_complete")


def test_class_history_staff_event_keeps_the_staff_role() -> None:
    event = ClassHistoryTeacherEvent(
        teacher_id=uuid4(),
        teacher_name="Cô Hạnh",
        staff_type="TEACHER",
        event_type="assigned",
        occurred_at="2026-08-04T00:00:00+07:00",
    )

    assert event.staff_type == "TEACHER"


def test_class_create_strips_name_whitespace() -> None:
    payload = make_class_create(name="  6C1  ")

    assert payload.name == "6C1"


def test_structured_class_keeps_the_entered_name_as_the_canonical_name() -> None:
    class_ = make_persisted_class(
        name="6C1",
        identity_scheme="ACADEMIC_YEAR",
        grade_level=6,
        academic_year_start=2026,
        program_name=None,
    )

    _synchronize_identity_metadata(class_)

    assert class_.name == "6C1"
    assert class_.education_level == "MIDDLE"
    assert get_class_labels(class_) == (
        "6C1",
        "Khối 6 · Năm học 2026–2027",
        "6C1 · Khối 6 · Năm học 2026–2027",
    )


def test_intake_class_needs_only_its_entered_name_and_opening_period() -> None:
    payload = make_class_create(
        name="IELTS 7.0 - A",
        identity_scheme="INTAKE",
        grade_level=None,
        academic_year_start=None,
        program_name=None,
        start_date=date.fromordinal(business_today().toordinal() + 1),
    )
    class_ = make_persisted_class(
        name=payload.name,
        identity_scheme="INTAKE",
        class_category="IELTS",
        grade_mode="NONE",
        program_name="IELTS",
        grade_level=None,
        academic_year_start=None,
        start_date=payload.start_date,
    )

    _synchronize_identity_metadata(class_)

    assert payload.program_name is None
    assert class_.program_name is None
    assert get_class_labels(class_) == (
        "IELTS 7.0 - A",
        "IELTS · Mở lớp 08/2026",
        "IELTS 7.0 - A · IELTS · Mở lớp 08/2026",
    )


@pytest.mark.parametrize("name", ["", "   ", "a" * 121])
def test_class_create_rejects_blank_or_oversized_name(name: str) -> None:
    with pytest.raises(ValidationError):
        make_class_create(name=name)


def test_class_create_accepts_name_at_maximum_length() -> None:
    payload = make_class_create(name="a" * 120)

    assert len(payload.name) == 120


@pytest.mark.parametrize("name", ["", "   ", "a" * 121])
def test_class_update_rejects_blank_or_oversized_name(name: str) -> None:
    with pytest.raises(ValidationError):
        ClassUpdate(name=name)


@pytest.mark.parametrize(
    "field",
    ["name", "type", "base_fee", "billing_cycle_months", "is_active"],
)
def test_class_update_rejects_explicit_null_for_required_columns(field: str) -> None:
    with pytest.raises(ValidationError):
        ClassUpdate(**{field: None})


def test_class_create_requires_at_least_one_teacher() -> None:
    with pytest.raises(ValidationError):
        make_class_create(teacher_ids=[])


@pytest.mark.parametrize("schedule", [None, {}, {"text": "", "slots": []}])
def test_class_create_requires_schedule(schedule: object) -> None:
    with pytest.raises(ValidationError):
        make_class_create(schedule=schedule)


def test_class_create_accepts_legacy_teacher_id() -> None:
    teacher_id = uuid4()

    payload = make_class_create(teacher_ids=[], teacher_id=teacher_id)

    assert payload.teacher_id == teacher_id


def test_class_create_deduplicates_teacher_ids_in_input_order() -> None:
    first_teacher_id = uuid4()
    second_teacher_id = uuid4()

    payload = make_class_create(
        teacher_ids=[first_teacher_id, second_teacher_id, first_teacher_id]
    )

    assert payload.teacher_ids == [first_teacher_id, second_teacher_id]


def test_class_create_rejects_more_than_ten_teachers() -> None:
    with pytest.raises(ValidationError):
        make_class_create(teacher_ids=[uuid4() for _ in range(11)])


@pytest.mark.parametrize("billing_cycle_weeks", [1, 4, 10, 12, 24, 48])
def test_course_accepts_custom_week_packages(
    billing_cycle_weeks: int,
) -> None:
    start_date = business_today() + timedelta(days=1)
    payload = make_class_create(
        type="COURSE",
        billing_cycle_weeks=billing_cycle_weeks,
        start_date=start_date,
        end_date=start_date + timedelta(days=billing_cycle_weeks * 7 * 3),
    )

    assert payload.billing_cycle_weeks == billing_cycle_weeks


def test_course_accepts_duration_that_does_not_divide_exactly() -> None:
    """R6: end date is independent of package cadence; no exact division rule.

    Only end > start is enforced; fee cadence does not constrain class duration.
    """
    start_date = business_today() + timedelta(days=1)
    payload = make_class_create(
        type="COURSE",
        billing_cycle_weeks=10,
        start_date=start_date,
        end_date=start_date + timedelta(days=300),  # 300 = 30 gói 10 tuần + 10 ngày dư
    )

    assert payload.end_date == start_date + timedelta(days=300)


def test_course_accepts_end_date_shorter_than_billing_package() -> None:
    """Class duration is independent from the package billing cadence."""
    start_date = business_today() + timedelta(days=1)
    payload = make_class_create(
        type="COURSE",
        billing_cycle_weeks=10,
        start_date=start_date,
        end_date=start_date + timedelta(days=1),
    )
    assert payload.end_date == start_date + timedelta(days=1)


def test_monthly_class_accepts_end_not_multiple_of_month() -> None:
    """A monthly class may end on any date after its start date."""
    start_date = business_today() + timedelta(days=1)
    payload = make_class_create(
        type="MONTHLY",
        start_date=start_date,
        # start + 1 month + 1 day + 3 days dư — không chia tròn tháng
        end_date=start_date + timedelta(days=35),
    )

    assert payload.end_date == start_date + timedelta(days=35)


def test_monthly_class_requires_one_month_billing_cycle() -> None:
    with pytest.raises(ValidationError):
        make_class_create(type="MONTHLY", billing_cycle_months=3)


def test_class_fee_accepts_database_numeric_limit() -> None:
    payload = make_class_create(base_fee=999_999_999_999)

    assert payload.base_fee == 999_999_999_999


def test_class_fee_rejects_value_over_database_numeric_limit() -> None:
    with pytest.raises(ValidationError):
        make_class_create(base_fee=1_000_000_000_000)


@pytest.mark.parametrize(
    "schedule",
    [
        {"slots": [{"day": "Thứ 8", "start": "18:00", "end": "19:30"}]},
        {"slots": [{"day": "Thứ 2", "start": "24:00", "end": "25:00"}]},
        {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "18:00"}]},
        {"slots": [{"day": "Thứ 2", "start": "19:30", "end": "18:00"}]},
        {"slots": [{"day": "Thứ 2", "start": "18:00", "end": "18:30"}]},
        {"slots": [{"day": "Thứ 2", "start": "18:15", "end": "19:15"}]},
        {"slots": [{"day": "Thứ 2", "start": "06:30", "end": "07:30"}]},
        {"slots": [{"day": "Thứ 2", "start": "21:30", "end": "22:30"}]},
        {"text": "Thứ 2", "unknown": True},
    ],
)
def test_class_schedule_rejects_malformed_payloads(
    schedule: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        make_class_create(schedule=schedule)


def test_class_schedule_rejects_overlapping_slots_on_same_day() -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            schedule={
                "slots": [
                    {"day": "Thứ 2", "start": "18:00", "end": "19:30"},
                    {"day": "Thứ 2", "start": "19:00", "end": "20:30"},
                ]
            }
        )


def test_class_schedule_accepts_adjacent_slots_and_same_time_on_other_day() -> None:
    payload = make_class_create(
        schedule={
            "text": "Ba ca",
            "slots": [
                {"day": "Thứ 2", "start": "18:00", "end": "19:30"},
                {"day": "Thứ 2", "start": "19:30", "end": "21:00"},
                {"day": "Thứ 3", "start": "18:00", "end": "19:30"},
            ],
        }
    )

    assert payload.schedule is not None
    assert len(payload.schedule.slots) == 3


def test_class_schedule_rejects_more_than_four_weekly_slots() -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            schedule={
                "slots": [
                    {"day": "Thứ 2", "start": "08:00", "end": "09:00"},
                    {"day": "Thứ 3", "start": "08:00", "end": "09:00"},
                    {"day": "Thứ 4", "start": "08:00", "end": "09:00"},
                    {"day": "Thứ 5", "start": "08:00", "end": "09:00"},
                    {"day": "Thứ 6", "start": "08:00", "end": "09:00"},
                ]
            }
        )


def test_structured_class_requires_real_dates_and_identity_fields() -> None:
    with pytest.raises(ValidationError):
        make_class_create(identity_scheme="ACADEMIC_YEAR", start_date=None)

    payload = make_class_create(
        identity_scheme="ACADEMIC_YEAR",
        grade_level=6,
        academic_year_start=2026,
    )
    assert payload.identity_scheme == "ACADEMIC_YEAR"


@pytest.mark.parametrize("category", ["SPECIALIZED", "CUSTOM"])
@pytest.mark.parametrize(
    ("grade_mode", "grade_level"),
    [("GRADE", 9), ("NONE", None)],
)
def test_specialized_and_custom_classes_require_an_explicit_grade_choice(
    category: str,
    grade_mode: str,
    grade_level: int | None,
) -> None:
    payload = make_class_create(
        class_category=category,
        grade_mode=grade_mode,
        grade_level=grade_level,
    )

    assert payload.class_category == category
    assert payload.grade_mode == grade_mode


def test_custom_class_may_omit_academic_year() -> None:
    payload = make_class_create(
        class_category="CUSTOM",
        grade_mode="GRADE",
        grade_level=9,
        academic_year_start=None,
    )

    assert payload.academic_year_start is None


@pytest.mark.parametrize(
    ("grade_mode", "grade_level"),
    [("NONE", 9), ("GRADE", None)],
)
def test_specialized_class_rejects_an_inconsistent_grade_choice(
    grade_mode: str,
    grade_level: int | None,
) -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            class_category="SPECIALIZED",
            grade_mode=grade_mode,
            grade_level=grade_level,
        )


def test_ielts_class_rejects_grade_and_academic_year_metadata() -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            identity_scheme="INTAKE",
            class_category="IELTS",
            grade_mode="NONE",
            grade_level=8,
            academic_year_start=2026,
        )


def test_class_create_rejects_end_date_before_start_date() -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            start_date=date(2026, 7, 14),
            end_date=date(2026, 7, 13),
        )


@pytest.mark.parametrize("teacher_ids", [[], None])
def test_class_update_rejects_explicit_empty_teacher_list(
    teacher_ids: list[UUID] | None,
) -> None:
    with pytest.raises(ValidationError):
        ClassUpdate(teacher_ids=teacher_ids)


def test_class_update_preserves_end_date_concurrency_contract() -> None:
    payload = ClassUpdate(
        end_date=date(2027, 5, 31),
        end_date_change_reason="Điều chỉnh theo lịch nghỉ của trung tâm",
        expected_version=3,
    )

    assert payload.end_date_change_reason == "Điều chỉnh theo lịch nghỉ của trung tâm"
    assert payload.expected_version == 3


def test_monthly_class_update_accepts_an_explicit_null_week_cycle() -> None:
    """Full-form monthly updates must be able to clear course-only metadata."""

    payload = ClassUpdate(
        type="MONTHLY",
        billing_cycle_months=1,
        billing_cycle_weeks=None,
    )

    assert payload.billing_cycle_weeks is None


@pytest.mark.asyncio
async def test_class_update_rejects_explicit_null_legacy_teacher() -> None:
    class_id = uuid4()
    persisted_class = make_persisted_class(id=str(class_id))
    db = AsyncMock()

    with (
        patch(
            "app.services.class_service.get_class",
            new=AsyncMock(return_value=persisted_class),
        ) as get_class,
        patch(
            "app.services.class_service._get_class_assistant_ids",
            new=AsyncMock(return_value=[]),
        ),
    ):
        with pytest.raises(ValueError, match="ít nhất một giáo viên"):
            await update_class(db, class_id, ClassUpdate(teacher_id=None))

    get_class.assert_awaited_once_with(db, class_id, for_update=True)
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_class_update_validates_course_cycle_against_existing_type() -> None:
    class_id = uuid4()
    persisted_class = make_persisted_class(id=str(class_id))
    db = AsyncMock()

    with (
        patch(
            "app.services.class_service.get_class",
            new=AsyncMock(return_value=persisted_class),
        ),
        patch(
            "app.services.class_service._get_class_teacher_ids",
            new=AsyncMock(return_value=[str(persisted_class.teacher_id)]),
        ),
        patch(
            "app.services.class_service._get_class_assistant_ids",
            new=AsyncMock(return_value=[]),
        ),
    ):
        with pytest.raises(ValueError, match="cố định"):
            await update_class(
                db,
                class_id,
                ClassUpdate(billing_cycle_weeks=10),
            )

    db.commit.assert_not_awaited()
