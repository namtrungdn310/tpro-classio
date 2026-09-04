from datetime import date, datetime, time, timezone
from uuid import uuid4

from app.schemas.enrollment import EnrollmentResponse, EnrollmentScheduleSlotResponse


def test_enrollment_history_contract_keeps_lineage_end_and_schedule_details() -> None:
    previous_class_id = uuid4()
    response = EnrollmentResponse(
        id=uuid4(),
        student_id=uuid4(),
        class_id=uuid4(),
        custom_fee=350_000,
        status="dropped",
        enrollment_date=date(2026, 8, 20),
        ended_at=datetime(2027, 6, 6, tzinfo=timezone.utc),
        end_reason="Học viên rời lớp",
        selected_slot_ids=[],
        selected_slots=[
            EnrollmentScheduleSlotResponse(
                id=uuid4(),
                weekday="Thứ 2",
                local_start=time(13, 30),
                local_end=time(15, 0),
            )
        ],
        class_name="6C1",
        class_start_date=date(2026, 6, 6),
        class_end_date=date(2027, 6, 6),
        previous_class_id=previous_class_id,
        effective_fee=350_000,
    )

    assert response.previous_class_id == previous_class_id
    assert response.end_reason == "Học viên rời lớp"
    assert response.selected_slots[0].weekday == "Thứ 2"
