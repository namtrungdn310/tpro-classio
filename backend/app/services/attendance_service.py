"""R6-D16 — Attendance check-in + earning (server-authoritative).

Check-in derives staff/rate/amount/window from the Principal + canonical
occurrence + slot assignment; the request body cannot set staff/rate/amount.
Exactly one attendance + one EARNING per (staff, occurrence); idempotent by
request_id + unique constraint.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import BUSINESS_TIMEZONE
from app.models.staff_attendance import (
    StaffAttendanceEntry,
    StaffCompensationRate,
    StaffEarningLedgerEntry,
)
from app.schemas.attendance import (
    AttendanceCheckInRequest,
    AttendanceCheckInResponse,
    AttendanceTodayResponse,
    CheckInStatus,
)

CHECKIN_WINDOW_BEFORE_MINUTES = 30
CHECKIN_WINDOW_AFTER_MINUTES = 120


async def _resolve_rate(
    db: AsyncSession, staff_id: str, occurrence_date
) -> StaffCompensationRate | None:
    result = await db.execute(
        select(StaffCompensationRate)
        .where(
            StaffCompensationRate.staff_id == staff_id,
            StaffCompensationRate.effective_from <= occurrence_date,
            (StaffCompensationRate.effective_to.is_(None))
            | (StaffCompensationRate.effective_to > occurrence_date),
        )
        .order_by(StaffCompensationRate.effective_from.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_teacher_today(
    db: AsyncSession,
    principal,
) -> AttendanceTodayResponse:
    if principal.staff_id is None:
        raise HTTPException(status_code=403, detail="Tài khoản chưa liên kết nhân sự")
    from app.services.attendance_occurrence_service import teacher_today_occurrences

    occurrences, checkins = await teacher_today_occurrences(db, principal.staff_id)
    return AttendanceTodayResponse(
        staff_id=UUID(principal.staff_id),
        occurrences=occurrences,
        checkins=checkins,
    )


async def check_in(
    db: AsyncSession,
    principal,
    occurrence_id: UUID,
    data: AttendanceCheckInRequest,
) -> AttendanceCheckInResponse:
    if principal.staff_id is None:
        raise HTTPException(status_code=403, detail="Tài khoản chưa liên kết nhân sự")
    staff_id = principal.staff_id

    # Serialize retries and concurrent clicks for this principal.  The request
    # id is still validated below so it cannot be replayed across accounts.
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:scope))"),
        {"scope": f"attendance:{staff_id}:{occurrence_id}"},
    )

    existing = await db.scalar(
        select(StaffAttendanceEntry).where(
            StaffAttendanceEntry.request_id == str(data.request_id)
        )
    )
    if existing is not None:
        if existing.staff_id != staff_id:
            raise HTTPException(status_code=409, detail="Mã yêu cầu đã được sử dụng")
        return _to_checkin_response(existing)

    now = datetime.now(timezone.utc)
    from app.services.attendance_occurrence_service import resolve_occurrence_for_staff

    occurrence = await resolve_occurrence_for_staff(db, UUID(occurrence_id), staff_id)
    if occurrence is None:
        raise HTTPException(
            status_code=403,
            detail="Buổi học không thuộc nhân sự này hoặc không còn hiệu lực",
        )
    existing_occurrence = await db.scalar(
        select(StaffAttendanceEntry).where(
            StaffAttendanceEntry.staff_id == staff_id,
            StaffAttendanceEntry.occurrence_class_id == occurrence.class_id,
            StaffAttendanceEntry.occurrence_start_at == occurrence.original_start_at,
        )
    )
    if existing_occurrence is not None:
        return _to_checkin_response(existing_occurrence)
    start_local = occurrence.original_start_at.astimezone(BUSINESS_TIMEZONE)
    if now < start_local - timedelta(minutes=CHECKIN_WINDOW_BEFORE_MINUTES):
        raise HTTPException(
            status_code=409,
            detail="Chưa đến khung giờ cho phép chấm công",
        )
    if now > start_local + timedelta(minutes=CHECKIN_WINDOW_AFTER_MINUTES):
        raise HTTPException(
            status_code=409,
            detail="Đã quá khung giờ cho phép chấm công",
        )
    if occurrence.kind == "POSTPONED":
        raise HTTPException(
            status_code=409,
            detail="Buổi gốc đã hoãn; chỉ chấm buổi bù hợp lệ",
        )

    rate = await _resolve_rate(db, staff_id, start_local.date())
    if rate is None:
        raise HTTPException(
            status_code=409,
            detail="Chưa có mức lương hiệu lực cho nhân sự này tại ngày buổi học",
        )
    role = "TEACHER" if occurrence.staff_role == "TEACHER" else "ASSISTANT"
    entry = StaffAttendanceEntry(
        staff_id=staff_id,
        occurrence_class_id=occurrence.class_id,
        occurrence_slot_id=occurrence.slot_id,
        occurrence_start_at=occurrence.original_start_at,
        occurrence_end_at=occurrence.original_end_at,
        occurrence_kind=occurrence.kind,
        staff_role=role,
        scheduled_start_at=occurrence.original_start_at,
        checkin_at=now,
        rate_amount=int(rate.rate_amount),
        rate_version=rate.version,
        request_id=str(data.request_id),
    )
    db.add(entry)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        replay = await db.scalar(
            select(StaffAttendanceEntry).where(
                StaffAttendanceEntry.staff_id == staff_id,
                StaffAttendanceEntry.occurrence_class_id == occurrence.class_id,
                StaffAttendanceEntry.occurrence_start_at
                == occurrence.original_start_at,
            )
        )
        if replay is not None:
            return _to_checkin_response(replay)
        raise HTTPException(
            status_code=409, detail="Buổi học vừa được chấm công ở một phiên khác"
        ) from exc
    db.add(
        StaffEarningLedgerEntry(
            staff_id=staff_id,
            attendance_entry_id=entry.id,
            entry_type="EARNING",
            amount=int(rate.rate_amount),
            request_id=str(data.request_id),
        )
    )
    await db.commit()
    refreshed = await db.scalar(
        select(StaffAttendanceEntry).where(StaffAttendanceEntry.id == entry.id)
    )
    return _to_checkin_response(refreshed or entry)


def _to_checkin_response(entry: StaffAttendanceEntry) -> AttendanceCheckInResponse:
    return AttendanceCheckInResponse(
        attendance_id=UUID(str(entry.id)),
        status=CheckInStatus.CHECKED_IN,
        checkin_at=entry.checkin_at,
        rate_amount=int(entry.rate_amount),
        occurrence_start_at=entry.occurrence_start_at,
    )
