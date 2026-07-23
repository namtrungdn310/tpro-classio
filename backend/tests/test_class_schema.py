from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.models.class_ import Class
from app.schemas.class_ import ClassCreate, ClassUpdate
from app.services.class_service import (
    _classes_cache,
    _read_classes_cache,
    _write_classes_cache,
    clear_classes_cache,
    update_class,
)


def make_class_create(**overrides: object) -> ClassCreate:
    payload: dict[str, object] = {
        "name": "6C1",
        "type": "MONTHLY",
        "base_fee": 750_000,
        "billing_cycle_months": 1,
        "teacher_ids": [uuid4()],
        "schedule": {
            "slots": [
                {"day": "Thứ 2", "start": "18:00", "end": "19:30"},
            ]
        },
    }
    payload.update(overrides)
    return ClassCreate(**payload)


def make_persisted_class(**overrides: object) -> Class:
    payload: dict[str, object] = {
        "id": str(uuid4()),
        "name": "IELTS Chuyên sâu",
        "type": "COURSE",
        "base_fee": Decimal("4800000"),
        "billing_cycle_months": 3,
        "teacher_id": str(uuid4()),
        "is_active": True,
    }
    payload.update(overrides)
    return Class(**payload)


def test_classes_cache_has_a_bounded_number_of_search_entries() -> None:
    clear_classes_cache()
    try:
        for index in range(129):
            _write_classes_cache((f"query-{index}", None, True), [])

        assert len(_classes_cache) == 128
        assert _read_classes_cache(("query-0", None, True)) is None
        assert _read_classes_cache(("query-128", None, True)) == []
    finally:
        clear_classes_cache()


def test_class_create_strips_name_whitespace() -> None:
    payload = make_class_create(name="  6C1  ")

    assert payload.name == "6C1"


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


@pytest.mark.parametrize("billing_cycle_months", [2, 3, 6, 12])
def test_course_accepts_supported_billing_cycles(
    billing_cycle_months: int,
) -> None:
    payload = make_class_create(
        type="COURSE",
        billing_cycle_months=billing_cycle_months,
    )

    assert payload.billing_cycle_months == billing_cycle_months


@pytest.mark.parametrize("billing_cycle_months", [1, 4, 5, 24])
def test_course_rejects_unsupported_billing_cycles(
    billing_cycle_months: int,
) -> None:
    with pytest.raises(ValidationError):
        make_class_create(
            type="COURSE",
            billing_cycle_months=billing_cycle_months,
        )


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


@pytest.mark.asyncio
async def test_class_update_rejects_explicit_null_legacy_teacher() -> None:
    class_id = uuid4()
    persisted_class = make_persisted_class(id=str(class_id))
    db = AsyncMock()

    with patch(
        "app.services.class_service.get_class",
        new=AsyncMock(return_value=persisted_class),
    ) as get_class:
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
    ):
        with pytest.raises(ValueError, match="Thời lượng gói"):
            await update_class(
                db,
                class_id,
                ClassUpdate(billing_cycle_months=4),
            )

    db.commit.assert_not_awaited()
