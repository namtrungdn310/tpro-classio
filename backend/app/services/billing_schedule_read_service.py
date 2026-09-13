"""Bounded display queries. Never used to build or execute financial plans."""

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, case, extract, func, or_, select
from sqlalchemy.orm import selectinload

from app.core.business_time import business_today
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.models.payment import Payment
from app.models.payment_request import PaymentRequest, PaymentRequestItem
from app.models.start_date_change_command import StartDateChangeCommandRecord as Command
from app.models.student import Student
from app.models.class_ import Class
from app.models.user import Profile
from app.services.independent_dates_guard import require_date_contract


async def read_report_enrollments(db, *, q="", page=1):
    require_date_contract(4, has_date_edit=False)
    query = (
        select(
            Enrollment.id,
            Student.full_name.label("student_name"),
            Class.name.label("class_name"),
            Enrollment.enrollment_date,
            Enrollment.status,
        )
        .join(
            Student,
            and_(
                Student.id == Enrollment.student_id,
                Student.workspace_id == Enrollment.workspace_id,
            ),
        )
        .join(
            Class,
            and_(
                Class.id == Enrollment.class_id,
                Class.workspace_id == Enrollment.workspace_id,
            ),
        )
    )
    if q.strip():
        term = (
            "%"
            + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%"
        )
        query = query.where(
            or_(
                Student.full_name.ilike(term, escape="\\"),
                Class.name.ilike(term, escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    page = min(page, max(1, (total + 19) // 20))
    rows = (
        (
            await db.execute(
                query.order_by(Student.full_name, Class.name, Enrollment.id)
                .offset((page - 1) * 20)
                .limit(20)
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "has_next": page * 20 < total,
    }


async def read_schedule_history(db, enrollment_id: UUID, *, year=None, page=1):
    enrollment = await load_summary_enrollment(db, enrollment_id)
    # Calendar year of the operation in Vietnam, not year of the affected fee cycle.
    from zoneinfo import ZoneInfo

    zone = ZoneInfo("Asia/Ho_Chi_Minh")
    scope = [
        Command.workspace_id == enrollment.workspace_id,
        Command.operation_kind == "BILLING_SCHEDULE_CHANGE",
        Command.state == "COMPLETED",
        Command.execution_plan["response"]["plan"]["enrollment_id"].astext
        == str(enrollment.id),
    ]
    years = (
        await db.scalars(
            select(
                extract("year", func.timezone("Asia/Ho_Chi_Minh", Command.created_at))
            )
            .where(*scope)
            .distinct()
        )
    ).all()
    selected_year = business_today().year if year is None else year
    if selected_year:
        scope.extend(
            (
                Command.created_at
                >= datetime(selected_year, 1, 1, tzinfo=zone).astimezone(timezone.utc),
                Command.created_at
                < datetime(selected_year + 1, 1, 1, tzinfo=zone).astimezone(
                    timezone.utc
                ),
            )
        )
    total = await db.scalar(select(func.count()).select_from(Command).where(*scope))
    page = min(page, max(1, (total + 19) // 20))
    rows = (
        await db.execute(
            select(Command, Profile.full_name)
            .outerjoin(
                Profile,
                and_(
                    Profile.id == Command.actor_user_id,
                    Profile.workspace_id == Command.workspace_id,
                ),
            )
            .where(*scope)
            .order_by(Command.created_at.desc(), Command.id.desc())
            .offset((page - 1) * 20)
            .limit(20)
        )
    ).all()
    items = []
    for command, actor in rows:
        plan = (command.execution_plan or {}).get("response", {}).get("plan", {})
        items.append(
            {
                "id": command.id,
                "old_date": command.old_date,
                "new_date": command.new_date,
                "reason": command.reason,
                "created_at": command.created_at,
                "actor_name": actor,
                "created_count": len(
                    (command.execution_plan or {}).get("created_fee_ids", [])
                ),
                "replaced_count": len(plan.get("supersede_ids", [])),
                "kept_count": len(plan.get("keep_ids", [])),
                "charges": plan.get("charges", []),
                "waived_intervals": plan.get("waived_intervals", []),
            }
        )
    return {
        "items": items,
        "total": total,
        "page": page,
        "has_next": page * 20 < total,
        "current_year": business_today().year,
        "available_years": sorted(
            {business_today().year, *(int(y) for y in years)}, reverse=True
        ),
    }


async def load_summary_enrollment(db, enrollment_id: UUID):
    require_date_contract(4, has_date_edit=False)
    enrollment = await db.scalar(
        select(Enrollment)
        .where(Enrollment.id == str(enrollment_id))
        .options(
            selectinload(Enrollment.current_billing_revision),
            selectinload(Enrollment.class_),
        )
    )
    if enrollment is None:
        raise HTTPException(404, "Không tìm thấy lượt học")
    return enrollment


async def read_schedule_summary(db, enrollment_id: UUID):
    enrollment = await load_summary_enrollment(db, enrollment_id)
    revision = enrollment.current_billing_revision
    from app.services.class_service import _load_next_fee_due_map

    today = business_today()
    due_map = await _load_next_fee_due_map(
        db, [enrollment.class_], today, enrollment_ids_filter=[str(enrollment.id)]
    )
    next_due = due_map.get(enrollment.class_id, (None, None))[0]
    current = await db.scalar(
        select(FeeRecord)
        .where(
            FeeRecord.enrollment_id == enrollment.id,
            FeeRecord.status.notin_(("VOID", "SUPERSEDED")),
        )
        .order_by(
            case(
                (
                    and_(
                        FeeRecord.coverage_start <= today,
                        FeeRecord.coverage_end > today,
                    ),
                    0,
                ),
                (FeeRecord.status == "UNPAID", 1),
                else_=2,
            ),
            func.coalesce(FeeRecord.adjusted_due_date, FeeRecord.due_date),
            FeeRecord.id,
        )
        .limit(1)
    )
    curr_period = current.period if current else None
    curr_fee_status = current.status if current else None
    next_period = next_due.strftime("%Y-%m") if next_due else None
    return {
        "enrollment_id": enrollment.id,
        "anchor_date": revision.anchor_date if revision else None,
        "version": enrollment.billing_anchor_version,
        "billing_type": revision.billing_type_snapshot if revision else None,
        "cycle_weeks": revision.billing_cycle_weeks_snapshot if revision else None,
        "review_pending": bool(revision and revision.state == "PENDING"),
        "current_period": curr_period,
        "current_fee_status": curr_fee_status,
        "next_period": next_period,
        "next_due_date": next_due.isoformat() if next_due else None,
    }


def fee_list_expressions():
    f = FeeRecord
    due = func.coalesce(f.adjusted_due_date, f.due_date)
    cycle_date = func.coalesce(f.coverage_start, due)
    current = f.status.notin_(("VOID", "SUPERSEDED"))
    is_paid_expr = or_(
        f.status == "PAID",
        and_(f.paid_amount.is_not(None), f.paid_amount >= f.final_amount),
        f.paid_date.is_not(None),
    )
    pending = and_(
        current, ~is_paid_expr, func.coalesce(f.paid_amount, 0) < f.final_amount
    )
    return due, cycle_date, current, pending


async def read_schedule_fees(
    db,
    enrollment_id: UUID,
    *,
    year=None,
    state="ALL",
    include_inactive=False,
    order="desc",
    page=1,
    page_size=20,
):
    enrollment = await load_summary_enrollment(db, enrollment_id)
    f = FeeRecord
    due, cycle_date, current, pending = fee_list_expressions()
    selected_year = business_today().year if year is None else year
    scope = (
        f.enrollment_id == enrollment.id,
        f.workspace_id == enrollment.workspace_id,
    )
    years = (
        await db.scalars(
            select(extract("year", cycle_date))
            .where(*scope, cycle_date.is_not(None))
            .distinct()
        )
    ).all()
    available_years = sorted(
        {business_today().year, *(int(y) for y in years)}, reverse=True
    )
    predicates = list(scope)
    if selected_year:
        predicates.extend(
            (
                cycle_date >= date(selected_year, 1, 1),
                cycle_date < date(selected_year + 1, 1, 1),
            )
        )
    if not include_inactive:
        predicates.append(current)
    if state == "PENDING":
        predicates.append(pending)
    elif state == "PAID":
        is_paid_expr = or_(
            f.status == "PAID",
            and_(f.paid_amount.is_not(None), f.paid_amount > 0),
            f.paid_date.is_not(None),
        )
        predicates.append(
            and_(current, is_paid_expr, func.coalesce(f.refunded_amount, 0) == 0)
        )
    elif state == "REFUNDED":
        predicates.append(and_(current, f.refunded_amount > 0))
    total = await db.scalar(select(func.count()).select_from(f).where(*predicates))
    # Count ALL old pending obligations, independently of page and status filters.
    old_pending = await db.scalar(
        select(func.count())
        .select_from(f)
        .where(
            *scope,
            pending,
            cycle_date < date(selected_year or business_today().year, 1, 1),
        )
    )
    unknown_pending = await db.scalar(
        select(func.count()).select_from(f).where(*scope, pending, cycle_date.is_(None))
    )
    actual_page = min(page, max(1, (total + page_size - 1) // page_size))
    has_payments = (
        select(Payment.id)
        .where(Payment.fee_record_id == f.id, Payment.workspace_id == f.workspace_id)
        .exists()
    )
    grouped = (
        select(PaymentRequestItem.payment_request_id)
        .where(
            PaymentRequestItem.fee_record_id == f.id,
            PaymentRequestItem.workspace_id == f.workspace_id,
        )
        .correlate(f)
    )
    has_qr = (
        select(PaymentRequest.id)
        .where(
            PaymentRequest.workspace_id == f.workspace_id,
            or_(PaymentRequest.fee_record_id == f.id, PaymentRequest.id.in_(grouped)),
            or_(
                PaymentRequest.sent_at.is_not(None),
                PaymentRequest.paid_at.is_not(None),
                PaymentRequest.status == "PAID",
            ),
        )
        .exists()
    )
    protected = or_(
        f.status == "PAID",
        f.paid_amount > 0,
        f.paid_date.is_not(None),
        f.refunded_amount > 0,
        f.notified_at.is_not(None),
        has_payments,
        has_qr,
    )
    keys = (cycle_date, f.coverage_end, due, f.id)
    ordering = [getattr(key, order)().nulls_last() for key in keys]
    rows = (
        (
            await db.execute(
                select(
                    f.id,
                    due.label("due_date"),
                    f.coverage_start,
                    f.coverage_end,
                    f.final_amount.label("amount"),
                    f.status,
                    func.coalesce(f.paid_amount, 0).label("paid_amount"),
                    f.refunded_amount,
                    func.coalesce(protected, False).label("protected"),
                )
                .where(*predicates)
                .order_by(*ordering)
                .offset((actual_page - 1) * page_size)
                .limit(page_size)
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": actual_page,
        "page_size": page_size,
        "year": selected_year or None,
        "current_year": business_today().year,
        "available_years": available_years,
        "older_pending_count": old_pending,
        "undated_pending_count": unknown_pending,
        "has_next": actual_page * page_size < total,
    }
