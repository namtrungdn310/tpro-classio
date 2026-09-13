"""Bounded, read-only suspension audit inside the enrollment report."""

from datetime import datetime, timezone
from sqlalchemy import and_, case, func, literal, or_, select, union_all
from app.core.business_time import BUSINESS_TIMEZONE, business_today
from app.models.enrollment_suspension import EnrollmentSuspension, SuspensionCommand
from app.models.enrollment_service_credit_event import (
    EnrollmentServiceCreditEvent as Event,
)
from app.models.makeup import ClassScheduleAdjustment as Adjustment
from app.models.user import Profile
from app.services.billing_schedule_read_service import load_summary_enrollment
from app.services.credit_service import pending_service_credits
from app.services.suspension_union_service import (
    effective_preservation,
    load_pause_intervals,
)


async def read_suspension_history(db, enrollment_id, *, year=None, page=1):
    enrollment = await load_summary_enrollment(db, enrollment_id)
    workspace = enrollment.workspace_id
    private_ids = select(EnrollmentSuspension.id).where(
        EnrollmentSuspension.workspace_id == workspace,
        EnrollmentSuspension.enrollment_id == enrollment.id,
    )
    class_scope = [
        Adjustment.workspace_id == workspace,
        Adjustment.class_id == enrollment.class_id,
        Adjustment.adjustment_kind == "CLASS_SUSPENSION",
    ]
    # Class-wide receipts concern only membership time, never another class or
    # an earlier/later enrollment of the same student.
    if enrollment.enrollment_date:
        class_scope.append(Adjustment.affected_through >= enrollment.enrollment_date)
    if enrollment.ended_on:
        class_scope.append(Adjustment.affected_from < enrollment.ended_on)
    class_ids = select(Adjustment.id).where(*class_scope)
    creation = select(
        Adjustment.id,
        Adjustment.created_at,
        Adjustment.created_by.label("actor_id"),
        literal("CLASS_CREATE").label("kind"),
        Adjustment.create_payload.label("payload"),
        Adjustment.create_result.label("result"),
    ).where(*class_scope)
    commands = select(
        SuspensionCommand.id,
        SuspensionCommand.created_at,
        SuspensionCommand.actor_id,
        case(
            (SuspensionCommand.enrollment_suspension_id.is_not(None), "INDIVIDUAL"),
            else_="CLASS_CHANGE",
        ).label("kind"),
        SuspensionCommand.payload,
        SuspensionCommand.result,
    ).where(
        SuspensionCommand.workspace_id == workspace,
        or_(
            SuspensionCommand.enrollment_suspension_id.in_(private_ids),
            SuspensionCommand.class_adjustment_id.in_(class_ids),
        ),
        # A class pause can source a single member's waiver/closure correction.
        # Filter before count/year/paging, not only while rendering the rows.
        or_(
            SuspensionCommand.payload["action"].astext.is_(None),
            SuspensionCommand.payload["action"].astext.notin_(
                ("WAIVER_RECONCILIATION", "MEMBERSHIP_CLOSED")
            ),
            SuspensionCommand.payload["enrollment_id"].astext == str(enrollment.id),
        ),
    )
    history = union_all(creation, commands).subquery()
    years = (
        await db.scalars(
            select(
                func.extract(
                    "year", func.timezone("Asia/Ho_Chi_Minh", history.c.created_at)
                )
            ).distinct()
        )
    ).all()
    selected_year = business_today().year if year is None else year
    scope = []
    if selected_year:
        scope = [
            history.c.created_at
            >= datetime(selected_year, 1, 1, tzinfo=BUSINESS_TIMEZONE).astimezone(
                timezone.utc
            ),
            history.c.created_at
            < datetime(selected_year + 1, 1, 1, tzinfo=BUSINESS_TIMEZONE).astimezone(
                timezone.utc
            ),
        ]
    total = int(
        await db.scalar(select(func.count()).select_from(history).where(*scope)) or 0
    )
    page = min(page, max(1, (total + 19) // 20))
    rows = (
        (
            await db.execute(
                select(history, Profile.full_name.label("actor_name"))
                .outerjoin(
                    Profile,
                    and_(
                        Profile.id == history.c.actor_id,
                        Profile.workspace_id == workspace,
                    ),
                )
                .where(*scope)
                .order_by(history.c.created_at.desc(), history.c.id.desc())
                .offset((page - 1) * 20)
                .limit(20)
            )
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        payload, result = row["payload"] or {}, row["result"] or {}
        member = (
            result
            if row["kind"] == "INDIVIDUAL"
            or payload.get("action") in ("WAIVER_RECONCILIATION", "MEMBERSHIP_CLOSED")
            else next(
                (
                    m
                    for m in result.get("member_summary", [])
                    if m["enrollment_id"] == str(enrollment.id)
                ),
                {},
            )
        )
        items.append(
            dict(
                id=row["id"],
                created_at=row["created_at"],
                actor_name=row["actor_name"],
                kind=row["kind"],
                action="CANCEL"
                if payload.get("cancel") or payload.get("action") == "CANCEL"
                else "SAVE",
                reason=payload.get("reason")
                or payload.get("reason_note")
                or payload.get("reason_code")
                or "Hoãn lớp (dữ liệu cũ)",
                suspended_from=payload.get("suspended_from"),
                resume_on=payload.get("resume_on"),
                delta_days=member.get("delta_days", member.get("overlap_days", 0)),
                pending_days=member.get("pending_days", 0),
                old_due_date=member.get("old_due_date"),
                new_due_date=member.get("new_due_date"),
            )
        )
    ledger_days = int(
        await db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        Event.credit_days
                        * case((Event.event_type == "REVERSAL", -1), else_=1)
                    ),
                    0,
                )
            ).where(
                Event.enrollment_id == enrollment.id, Event.workspace_id == workspace
            )
        )
        or 0
    )
    # Current state is explicitly separate from immutable command-time results.
    pauses = await load_pause_intervals(db, enrollment)
    entitlement = sum(i.days for i in effective_preservation(enrollment, pauses))
    return dict(
        items=items,
        total=total,
        page=page,
        has_next=page * 20 < total,
        available_years=sorted(
            {business_today().year, *(int(y) for y in years)}, reverse=True
        ),
        ledger_days=ledger_days,
        preserved_days=entitlement,
        pending_days=sum(
            d for _, d in await pending_service_credits(db, enrollment.id)
        ),
        reconciliation_days=entitlement - ledger_days,
        membership_closed=enrollment.status != "active",
    )
