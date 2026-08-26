"""Guards for creating or moving an enrollment into a class.

An open whole-class suspension is a service interruption, not a class
deletion.  Existing memberships remain valid, but a new membership cannot
start inside the half-open suspension interval ``[affected_from,
affected_through + 1 day)``.  Profile-only student creation is intentionally
not covered by this module.
"""

from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.class_ import Class
from app.models.makeup import ClassScheduleAdjustment


async def get_open_suspension(
    db: AsyncSession,
    class_id: str,
    enrollment_date: date,
) -> ClassScheduleAdjustment | None:
    """Return the open suspension containing ``enrollment_date``.

    ``affected_through`` is stored as an inclusive audit date, while the
    business interval is half-open and therefore includes dates through that
    value only.  Ordering makes the result deterministic if old data contains
    overlapping adjustments; overlap validation on new writes remains the
    primary protection.
    """

    return await db.scalar(
        select(ClassScheduleAdjustment)
        .where(
            ClassScheduleAdjustment.class_id == class_id,
            ClassScheduleAdjustment.status == "OPEN",
            ClassScheduleAdjustment.affected_from <= enrollment_date,
            ClassScheduleAdjustment.affected_through >= enrollment_date,
        )
        .order_by(
            ClassScheduleAdjustment.affected_from.desc(),
            ClassScheduleAdjustment.created_at.desc(),
        )
        .limit(1)
    )


async def ensure_enrollment_allowed(
    db: AsyncSession,
    class_: Class,
    enrollment_date: date,
) -> None:
    """Reject a new/relocated enrollment during an open class suspension."""

    adjustment = await get_open_suspension(db, str(class_.id), enrollment_date)
    if adjustment is None:
        return

    resume_on = adjustment.affected_through + timedelta(days=1)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "CLASS_SUSPENDED",
            "message": (
                f"Lớp đang hoãn đến ngày {resume_on.strftime('%d/%m/%Y')}; "
                "không thể ghi danh trong thời gian này"
            ),
            "class_id": str(class_.id),
            "class_name": class_.name,
            "suspended_from": adjustment.affected_from.isoformat(),
            "resume_on": resume_on.isoformat(),
        },
        headers={"Cache-Control": "no-store"},
    )
