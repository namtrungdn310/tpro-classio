from datetime import datetime, timedelta, timezone

from app.core.occurrence import Occurrence, apply_exceptions, occurrence_key
from app.services.effective_occurrence_service import overlay_occurrences


def fixture():
    start = datetime(2026, 9, 14, 11, tzinfo=timezone.utc)
    occurrence = Occurrence(
        "class",
        occurrence_key("class", start),
        "REGULAR",
        start,
        start + timedelta(hours=1),
        "slot",
        source_slot_id="slot-id",
    )
    exception = dict(
        id="exception",
        status="MAKEUP_PENDING",
        original_start_at=start,
        original_end_at=occurrence.original_end_at,
        source_slot_id="slot-id",
        staff_snapshots=[dict(staff_id="teacher", role="TEACHER")],
    )
    return occurrence, exception


def test_pending_original_cannot_be_rediscovered_for_attendance():
    occurrence, exception = fixture()
    assert apply_exceptions([occurrence], [exception], class_id="class") == []


def test_service_pause_also_suppresses_slots_added_after_command_but_not_resume_day():
    occurrence, _ = fixture()
    start = occurrence.original_start_at
    args = dict(
        class_id="class", range_start=start, range_end=start + timedelta(days=2)
    )
    assert (
        overlay_occurrences(
            [occurrence],
            [{"suspension_window": (start, start + timedelta(days=1))}],
            **args,
        )
        == []
    )
    assert overlay_occurrences(
        [occurrence],
        [{"suspension_window": (start - timedelta(days=1), start)}],
        **args,
    ) == [occurrence]


def test_replacement_outside_original_window_is_visible_and_keeps_slot_identity():
    occurrence, exception = fixture()
    start = occurrence.original_start_at + timedelta(days=30)
    exception.update(
        status="MAKEUP_SCHEDULED",
        replacement_start_at=start,
        replacement_end_at=start + timedelta(hours=1),
    )
    result = overlay_occurrences(
        [],
        [exception],
        class_id="class",
        range_start=start,
        range_end=start + timedelta(days=1),
    )
    assert len(result) == 1
    assert result[0].kind == "MAKEUP"
    assert result[0].source_slot_id == "slot-id"
    assert result[0].teacher_ids == ["teacher"]
    assert (
        overlay_occurrences(
            [],
            [exception],
            class_id="class",
            range_start=start + timedelta(days=2),
            range_end=start + timedelta(days=3),
        )
        == []
    )


def test_restored_or_cancelled_exception_never_resurrects_makeup_from_stale_fields():
    occurrence, exception = fixture()
    exception.update(
        replacement_start_at=occurrence.original_start_at + timedelta(days=1),
        replacement_end_at=occurrence.original_end_at + timedelta(days=1),
    )
    for status in ("RESTORED", "CANCELLED", "MAKEUP_PENDING"):
        exception["status"] = status
        result = apply_exceptions([occurrence], [exception], class_id="class")
        assert all(o.kind == "REGULAR" for o in result)
        assert len(result) == (1 if status == "RESTORED" else 0)
