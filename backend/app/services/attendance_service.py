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
from app.models.staff import StaffMember
from app.models.staff_attendance import (
    StaffAttendanceEntry,
    StaffCompensationRate,
    StaffEarningLedgerEntry,
)
from app.schemas.attendance import (
    AttendanceCheckInRequest,
    AttendanceCheckInResponse,
    AttendanceReversalCreate,
    AttendanceReversalResponse,
    AttendanceTodayResponse,
    ManualAttendanceCreate,
    ManualAttendanceTarget,
)

# There is intentionally no pre-start window: a staff member can only clock in
# from the exact start of the session until `checkin_window_after_hours` hours
# later (default 24h, customisable per staff member via migration 080).
DEFAULT_CHECKIN_WINDOW_AFTER_HOURS = 24


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

    staff = await db.get(StaffMember, staff_id)
    window_after_hours = (
        staff.checkin_window_after_hours
        if staff is not None and staff.checkin_window_after_hours >= 1
        else DEFAULT_CHECKIN_WINDOW_AFTER_HOURS
    )
    start_local = occurrence.original_start_at.astimezone(BUSINESS_TIMEZONE)
    # Chỉ chấm công từ ĐÚNG giờ bắt đầu buổi học trở đi (giờ VN — Đà Nẵng),
    # không có khoảng trước giờ.  Đóng cửa sổ sau `window_after_hours` giờ.
    if now < start_local:
        raise HTTPException(
            status_code=409,
            detail="Chưa đến giờ bắt đầu buổi học; chưa thể chấm công",
        )
    if now > start_local + timedelta(hours=window_after_hours):
        raise HTTPException(
            status_code=409,
            detail="Đã quá hạn chấm công cho buổi học này",
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
        status="CHECKED_IN",
        checkin_at=entry.checkin_at,
        rate_amount=int(entry.rate_amount),
        occurrence_start_at=entry.occurrence_start_at,
    )


async def list_manual_attendance_targets(
    db: AsyncSession,
    staff_id: UUID,
) -> list[ManualAttendanceTarget]:
    """Admin/dev picker: real sessions assigned to this staff that are not yet
    clocked in, from a few days in the past through the near future."""
    from app.models.class_ import Class
    from app.models.class_schedule_slot import ClassScheduleSlot, ClassScheduleSlotStaff
    from app.services.attendance_occurrence_service import attendance_occurrence_id
    from app.services.schedule_slot_service import load_class_slots_bulk
    from app.core.occurrence import expand_weekly_occurrences

    staff = await db.get(StaffMember, str(staff_id))
    if staff is None or not staff.is_active:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân sự")

    from app.core.business_time import business_today

    today = business_today()
    range_start = datetime.combine(
        today - timedelta(days=3), datetime.min.time(), tzinfo=BUSINESS_TIMEZONE
    )
    range_end = range_start + timedelta(days=7)
    today_start = datetime.combine(today, datetime.min.time(), tzinfo=BUSINESS_TIMEZONE)

    # Start from slots assigned to this staff member instead of expanding every
    # active class. The old implementation expanded all classes and issued one
    # assignment/check-in/rate query per occurrence (100+ round trips).
    assigned_rows = await db.execute(
        select(
            Class.id,
            Class.name,
            Class.start_date,
            Class.end_date,
            ClassScheduleSlot.id,
            ClassScheduleSlotStaff.role,
        )
        .join(ClassScheduleSlot, ClassScheduleSlot.class_id == Class.id)
        .join(
            ClassScheduleSlotStaff,
            ClassScheduleSlotStaff.slot_id == ClassScheduleSlot.id,
        )
        .where(
            ClassScheduleSlotStaff.staff_id == str(staff_id),
            Class.is_active.is_(True),
            Class.cancelled_at.is_(None),
            ClassScheduleSlot.effective_from <= today,
            (ClassScheduleSlot.effective_until.is_(None))
            | (ClassScheduleSlot.effective_until > today),
        )
    )

    class_meta: dict[str, tuple[str, object, object]] = {}
    assigned_roles: dict[str, str] = {}
    for (
        class_id,
        class_name,
        start_date,
        end_date,
        slot_id,
        role,
    ) in assigned_rows.all():
        class_key = str(class_id)
        class_meta[class_key] = (class_name, start_date, end_date)
        assigned_roles[str(slot_id)] = role

    if not class_meta:
        return []

    class_ids = list(class_meta)
    slots_by_class = await load_class_slots_bulk(
        db,
        class_ids,
        effective_at=today,
    )
    slot_ids = [
        str(slot["slot_id"])
        for slots in slots_by_class.values()
        for slot in slots
        if slot.get("slot_id")
    ]
    if not slot_ids:
        return []

    existing_entries = await db.execute(
        select(
            StaffAttendanceEntry.occurrence_slot_id,
            StaffAttendanceEntry.occurrence_start_at,
            StaffAttendanceEntry.reversed_at,
        ).where(
            StaffAttendanceEntry.staff_id == str(staff_id),
            StaffAttendanceEntry.occurrence_slot_id.in_(slot_ids),
            StaffAttendanceEntry.occurrence_start_at >= range_start,
            StaffAttendanceEntry.occurrence_start_at < range_end,
        )
    )
    active_checkins = {
        (str(slot_id), occurrence_start_at)
        for slot_id, occurrence_start_at, reversed_at in existing_entries.all()
        if reversed_at is None
    }
    rates = list(
        (
            await db.scalars(
                select(StaffCompensationRate)
                .where(StaffCompensationRate.staff_id == str(staff_id))
                .order_by(StaffCompensationRate.effective_from.desc())
            )
        ).all()
    )

    targets: list[ManualAttendanceTarget] = []
    for class_id, (class_name, start_date, end_date) in class_meta.items():
        schedule_slots = slots_by_class.get(class_id, [])
        if not schedule_slots:
            continue
        expanded = expand_weekly_occurrences(
            class_id=class_id,
            schedule={"slots": schedule_slots},
            start_date=start_date,
            end_date=end_date,
            range_start=range_start,
            range_end=range_end,
        )
        for occurrence in expanded:
            slot_id = str(occurrence.source_slot_id or "")
            if not slot_id or slot_id not in assigned_roles:
                continue
            # Sessions from today onward stay in the regular attendance screen;
            # this picker is only the short backfill window.
            if occurrence.original_start_at >= today_start:
                continue
            if (slot_id, occurrence.original_start_at) in active_checkins:
                continue
            occurrence_date = occurrence.original_start_at.astimezone(
                BUSINESS_TIMEZONE
            ).date()
            rate = next(
                (
                    item
                    for item in rates
                    if item.effective_from <= occurrence_date
                    and (
                        item.effective_to is None or item.effective_to > occurrence_date
                    )
                ),
                None,
            )
            targets.append(
                ManualAttendanceTarget(
                    occurrence_id=attendance_occurrence_id(occurrence.key),
                    class_name=class_name,
                    role=assigned_roles[slot_id],
                    occurrence_start_at=occurrence.original_start_at,
                    occurrence_end_at=occurrence.original_end_at,
                    kind=occurrence.kind,
                    rate_amount=int(rate.rate_amount) if rate else None,
                )
            )
    targets.sort(key=lambda item: item.occurrence_start_at)
    return targets


async def manual_check_in(
    db: AsyncSession,
    staff_id: UUID,
    data: ManualAttendanceCreate,
    *,
    actor_user_id: str,
) -> AttendanceCheckInResponse:
    """Admin/dev clock in a staff member against a real assigned session.

    Financial rules stay authoritative: the staff must be active, the session
    must belong to them and not already be clocked in, and a compensation rate
    must be effective on the session date.  The admin window is deliberately
    not time-gated (fixing a missed session); idempotency is by request_id.
    """
    staff = await db.get(StaffMember, str(staff_id))
    if staff is None or not staff.is_active:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân sự")

    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:scope))"),
        {"scope": f"attendance-admin:{staff_id}:{data.occurrence_id}"},
    )
    existing_request = await db.scalar(
        select(StaffAttendanceEntry).where(
            StaffAttendanceEntry.request_id == str(data.request_id)
        )
    )
    if existing_request is not None:
        if existing_request.staff_id != str(staff_id):
            raise HTTPException(status_code=409, detail="Mã yêu cầu đã được sử dụng")
        return _to_checkin_response(existing_request)

    from app.services.attendance_occurrence_service import resolve_occurrence_for_staff

    occurrence = await resolve_occurrence_for_staff(
        db,
        data.occurrence_id,
        str(staff_id),
        days_before=3,
        days_after=7,
    )
    if occurrence is None:
        raise HTTPException(
            status_code=403,
            detail="Buổi học không thuộc nhân sự này hoặc không còn hiệu lực",
        )
    if occurrence.kind == "POSTPONED":
        raise HTTPException(
            status_code=409,
            detail="Buổi gốc đã hoãn; chỉ chấm buổi bù hợp lệ",
        )
    existing_occurrence = await db.scalar(
        select(StaffAttendanceEntry).where(
            StaffAttendanceEntry.staff_id == str(staff_id),
            StaffAttendanceEntry.occurrence_class_id == occurrence.class_id,
            StaffAttendanceEntry.occurrence_start_at == occurrence.original_start_at,
            StaffAttendanceEntry.reversed_at.is_(None),
        )
    )
    if existing_occurrence is not None:
        raise HTTPException(
            status_code=409,
            detail="Buổi học này đã được chấm công",
        )

    start_local = occurrence.original_start_at.astimezone(BUSINESS_TIMEZONE)
    rate = await _resolve_rate(db, str(staff_id), start_local.date())
    if rate is None:
        raise HTTPException(
            status_code=409,
            detail="Chưa có mức lương hiệu lực cho nhân sự này tại ngày buổi học",
        )
    role = "TEACHER" if occurrence.staff_role == "TEACHER" else "ASSISTANT"
    now = datetime.now(timezone.utc)
    entry = StaffAttendanceEntry(
        staff_id=str(staff_id),
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
        raise HTTPException(
            status_code=409, detail="Buổi học vừa được chấm công ở một phiên khác"
        ) from exc
    db.add(
        StaffEarningLedgerEntry(
            staff_id=str(staff_id),
            attendance_entry_id=entry.id,
            entry_type="EARNING",
            amount=int(rate.rate_amount),
            request_id=str(data.request_id),
            actor_user_id=actor_user_id,
            reason=data.reason,
        )
    )
    await db.commit()
    refreshed = await db.scalar(
        select(StaffAttendanceEntry).where(StaffAttendanceEntry.id == entry.id)
    )
    return _to_checkin_response(refreshed or entry)


async def reverse_attendance(
    db: AsyncSession,
    staff_id: UUID,
    attendance_id: UUID,
    data: AttendanceReversalCreate,
    *,
    actor_user_id: str,
) -> AttendanceReversalResponse:
    """Undo a wrong check-in via an append-only compensating REVERSAL entry.

    Refuses when the earning has already been allocated into a live payroll
    settlement — undo the settlement first so the financial ledger never
    double-pays or goes negative in a settled window.
    """
    from app.models.staff_attendance import (
        StaffPayrollSettlement,
        StaffPayrollSettlementItem,
        StaffPayrollSettlementReversal,
    )

    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:scope))"),
        {"scope": f"attendance-admin:{staff_id}:{attendance_id}"},
    )
    replay = await db.scalar(
        select(StaffEarningLedgerEntry).where(
            StaffEarningLedgerEntry.request_id == str(data.request_id),
            StaffEarningLedgerEntry.entry_type == "REVERSAL",
        )
    )
    if replay is not None:
        if replay.staff_id != str(staff_id):
            raise HTTPException(status_code=409, detail="Mã yêu cầu đã được sử dụng")
        entry = await db.get(StaffAttendanceEntry, str(attendance_id))
        if entry is not None:
            return AttendanceReversalResponse(
                attendance_id=attendance_id,
                reversed_at=entry.reversed_at or replay.created_at,
                reason=data.reason,
            )

    entry = await db.get(StaffAttendanceEntry, str(attendance_id))
    if entry is None or entry.staff_id != str(staff_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy lần chấm công")
    if entry.reversed_at is not None:
        raise HTTPException(status_code=409, detail="Lần chấm công này đã được huỷ")

    earning = await db.scalar(
        select(StaffEarningLedgerEntry).where(
            StaffEarningLedgerEntry.attendance_entry_id == entry.id,
            StaffEarningLedgerEntry.entry_type == "EARNING",
            StaffEarningLedgerEntry.amount > 0,
        )
    )
    if earning is None:
        raise HTTPException(status_code=409, detail="Không tìm thấy bút toán thù lao")

    allocated = await db.scalar(
        select(StaffPayrollSettlementItem.id)
        .join(
            StaffPayrollSettlement,
            StaffPayrollSettlement.id == StaffPayrollSettlementItem.settlement_id,
        )
        .outerjoin(
            StaffPayrollSettlementReversal,
            StaffPayrollSettlementReversal.settlement_id == StaffPayrollSettlement.id,
        )
        .where(
            StaffPayrollSettlementItem.ledger_entry_id == earning.id,
            StaffPayrollSettlementReversal.id.is_(None),
        )
        .limit(1)
    )
    if allocated is not None:
        raise HTTPException(
            status_code=409,
            detail="Thù lao buổi này đã được tất toán; hãy hoàn tác lần tất toán trước",
        )

    now = datetime.now(timezone.utc)
    entry.reversed_at = now
    entry.reversed_by = actor_user_id
    entry.reversal_reason = data.reason
    db.add(
        StaffEarningLedgerEntry(
            staff_id=str(staff_id),
            attendance_entry_id=entry.id,
            entry_type="REVERSAL",
            amount=-int(entry.rate_amount),
            related_entry_id=earning.id,
            reason=data.reason,
            request_id=str(data.request_id),
            actor_user_id=actor_user_id,
        )
    )
    await db.commit()
    return AttendanceReversalResponse(
        attendance_id=attendance_id,
        reversed_at=now,
        reason=data.reason,
    )
