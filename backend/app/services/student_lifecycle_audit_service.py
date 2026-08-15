from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student_lifecycle_event import StudentLifecycleEvent


def append_student_lifecycle_event(
    db: AsyncSession,
    *,
    student_id: str,
    action: str,
    actor_user_id: str | None,
    previous_status: str | None,
    next_status: str | None,
    class_id: str | None = None,
    enrollment_id: str | None = None,
) -> None:
    """Append non-PII lifecycle metadata in the caller's transaction."""

    db.add(
        StudentLifecycleEvent(
            student_id=student_id,
            class_id=class_id,
            enrollment_id=enrollment_id,
            actor_user_id=actor_user_id,
            action=action,
            previous_status=previous_status,
            next_status=next_status,
        )
    )
