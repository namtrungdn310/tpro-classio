"""Add an idempotent, workspace-scoped dataset for manual UI testing.

This script is deliberately additive.  It never truncates tables and every row
uses a deterministic UUID from :data:`FIXTURE_NAMESPACE`, so running it twice
does not create duplicates.

Example (run from ``backend``)::

    .venv/Scripts/python scripts/seed_ui_test_data.py \
      --workspace-id 6afbc9d4-87e1-4943-b8ee-bd23dbc1254a \
      --confirm-additive-remote
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import sys
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.workspace import reset_workspace_id, set_workspace_id  # noqa: E402
from app.models import (  # noqa: E402
    Class,
    ClassScheduleSlot,
    ClassScheduleSlotStaff,
    ClassTeacher,
    Enrollment,
    FeeOperation,
    FeeOperationItem,
    FeeRecord,
    Payment,
    PaymentRequest,
    PaymentRequestEvent,
    PaymentRequestItem,
    Profile,
    StaffAttendanceEntry,
    StaffCompensationRate,
    StaffCompensationRateEvent,
    StaffEarningLedgerEntry,
    StaffMember,
    Student,
    Workspace,
    WorkspacePaymentAccount,
)
from app.schemas.fee import FeeBatchRefundRequest, FeeRefundItem  # noqa: E402
from app.schemas.makeup import PostponementCreateRequest  # noqa: E402
from app.schemas.staff import (  # noqa: E402
    StaffPayrollSettlementCreate,
    StaffPayrollSettlementReversalCreate,
)
from app.services.fee_service import refund_fee_records  # noqa: E402
from app.services.billing_anchor_service import ensure_initial_billing_revision  # noqa: E402
from app.services.class_makeup_service import (  # noqa: E402
    create_postponement,
    get_effective_occurrences_for_range,
)
from app.services.class_service import get_classes  # noqa: E402
from app.services.dashboard_service import get_dashboard_overview  # noqa: E402
from app.services.fee_service import get_fee_records  # noqa: E402
from app.services.paid_report_service import get_paid_fee_receipts  # noqa: E402
from app.services.staff_service import get_staff_members  # noqa: E402
from app.services.payroll_service import (  # noqa: E402
    reverse_staff_payroll_settlement,
    settle_staff_payroll,
)


FIXTURE_NAMESPACE = UUID("7c310c76-fb9c-4d8c-82ea-c0bb3c513eed")
MARKER = "[DỮ LIỆU MẪU]"
_fixture_workspace_id: UUID | None = None


def fixture_id(kind: str, key: str) -> str:
    if _fixture_workspace_id is None:
        raise RuntimeError("Fixture workspace must be initialized before creating IDs")
    return str(uuid5(FIXTURE_NAMESPACE, f"{_fixture_workspace_id}:{kind}:{key}"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", type=UUID)
    parser.add_argument(
        "--list-workspaces",
        action="store_true",
        help="List candidate workspaces without writing data.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify the complete fixture contract without writing data.",
    )
    parser.add_argument(
        "--confirm-additive-remote",
        action="store_true",
        help="Required when DATABASE_URL is not localhost. No existing row is deleted.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate all rows, then roll the transaction back.",
    )
    parser.add_argument(
        "--as-of-date",
        type=date.fromisoformat,
        default=None,
        help="Business date in YYYY-MM-DD. Defaults to today.",
    )
    return parser.parse_args()


def is_remote_database() -> bool:
    url = settings.database_url.lower()
    return not any(host in url for host in ("@localhost", "@127.0.0.1", "@::1"))


def schedule(*slots: tuple[str, str, str]) -> dict:
    payload = [{"day": day, "start": start, "end": end} for day, start, end in slots]
    return {
        "text": "; ".join(f"{day} ({start}-{end})" for day, start, end in slots),
        "slots": payload,
    }


def shift_month(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    month_end = (
        date(year + (month == 12), 1 if month == 12 else month + 1, 1)
        - timedelta(days=1)
    ).day
    return date(year, month, min(value.day, month_end))


async def add_once(db, model, **values):
    row_id = values.get("id")
    if row_id is not None and await db.get(model, row_id) is not None:
        return False
    db.add(model(**values))
    await db.flush()
    return True


async def add_payment_receipt(
    db,
    *,
    workspace_id: str,
    payment_id: str,
    fee_record_id: str,
    enrollment: Enrollment,
    student: Student,
    class_row: Class,
    period: str,
    due_date: date,
    paid_on: date,
    amount: int,
    payment_method: str,
    owner: Profile,
) -> tuple[int, int]:
    operation_id = fixture_id("fee-operation-payment", payment_id)
    operation_created = await add_once(
        db,
        FeeOperation,
        id=operation_id,
        workspace_id=workspace_id,
        action="payment",
        origin="system",
        request_id=fixture_id("fee-operation-request", payment_id),
        period=period,
        business_date=paid_on,
        occurred_at=datetime.combine(
            paid_on,
            time(hour=12),
            tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"),
        ),
        actor_user_id=str(owner.id),
        actor_name_snapshot=owner.full_name or owner.username,
        actor_username_snapshot=owner.username,
        actor_role_snapshot=owner.role,
        item_count=1,
        total_amount=Decimal(amount),
        schema_version=1,
    )
    item_created = await add_once(
        db,
        FeeOperationItem,
        id=fixture_id("fee-operation-payment-item", payment_id),
        workspace_id=workspace_id,
        operation_id=operation_id,
        ordinal=1,
        fee_record_id=fee_record_id,
        enrollment_id=enrollment.id,
        student_id=student.id,
        student_code_snapshot=student.student_code,
        student_name_snapshot=student.full_name,
        class_id=class_row.id,
        class_name_snapshot=class_row.name,
        period=period,
        state_before="NOTIFIED_UNPAID",
        state_after="PAID",
        amount_before=Decimal(0),
        amount_after=Decimal(amount),
        amount_delta=Decimal(amount),
        due_date_before=due_date,
        due_date_after=due_date,
        payment_method=payment_method,
        payment_id=payment_id,
    )
    return int(operation_created), int(item_created)


async def verify_fixture(db, workspace_id: str, as_of_date: date) -> None:
    current_period = f"{as_of_date:%Y-%m}"
    checks = {
        "classes": (
            "select count(*) from public.classes where workspace_id = :workspace_id",
            21,
        ),
        "students": (
            "select count(*) from public.students where workspace_id = :workspace_id",
            33,
        ),
        "enrollments": (
            "select count(*) from public.enrollments e join public.students s on s.id=e.student_id "
            "where e.workspace_id=:workspace_id",
            52,
        ),
        "fees": (
            "select count(*) from public.fee_records f join public.enrollments e on e.id=f.enrollment_id "
            "join public.students s on s.id=e.student_id where f.workspace_id=:workspace_id",
            293,
        ),
        "current_period_fees": (
            "select count(*) from public.fee_records where workspace_id=:workspace_id "
            "and period=:current_period and voided_at is null",
            24,
        ),
        "current_period_payments": (
            "select count(*) from public.payments p join public.fee_records f "
            "on f.id=p.fee_record_id where p.workspace_id=:workspace_id "
            "and f.period=:current_period and p.entry_type='payment'",
            12,
        ),
        "operational_schedule_slots": (
            "select count(*) from public.class_schedule_slots s join public.classes c "
            "on c.id=s.class_id where s.workspace_id=:workspace_id "
            "and c.is_active is true and c.cancelled_at is null and c.completed_at is null "
            "and c.stopped_on is null",
            18,
        ),
        "active_teachers": (
            "select count(*) from public.staff_members where workspace_id=:workspace_id "
            "and staff_type='TEACHER' and is_active is true",
            3,
        ),
        "active_assistants": (
            "select count(*) from public.staff_members where workspace_id=:workspace_id "
            "and staff_type='ASSISTANT' and is_active is true",
            3,
        ),
        "staff": (
            "select count(*) from public.staff_members where workspace_id=:workspace_id",
            7,
        ),
        "learning_history": (
            "select count(*) from public.enrollments where workspace_id=:workspace_id and status in ('completed','dropped','cancelled')",
            21,
        ),
        "billing_anchors": (
            "select count(*) from public.billing_anchor_revisions r join public.enrollments e on e.id=r.enrollment_id "
            "join public.students s on s.id=e.student_id where r.workspace_id=:workspace_id",
            52,
        ),
        "bank_accounts": (
            "select count(*) from public.workspace_payment_accounts where workspace_id=:workspace_id and is_active is true",
            1,
        ),
        "payment_requests": (
            "select count(*) from public.payment_requests where workspace_id=:workspace_id",
            1,
        ),
    }
    failures: list[str] = []
    for label, (statement, minimum) in checks.items():
        count = int(
            await db.scalar(
                text(statement),
                {
                    "workspace_id": workspace_id,
                    "current_period": current_period,
                },
            )
            or 0
        )
        print(f"VERIFY {label}: {count} (minimum {minimum})")
        if count < minimum:
            failures.append(f"{label}={count}<{minimum}")
    if failures:
        raise SystemExit("Fixture verification failed: " + ", ".join(failures))

    week_start = as_of_date - timedelta(days=as_of_date.weekday())
    weekly_class_occurrences = await get_effective_occurrences_for_range(
        db,
        week_start,
        week_start + timedelta(days=6),
    )
    dashboard = await get_dashboard_overview(db)
    paid_report = await get_paid_fee_receipts(db, period=current_period)
    app_views = {
        "operational_class_cards": len(await get_classes(db, scope="operational")),
        "staff_cards": len(await get_staff_members(db)),
        "weekly_schedule_occurrences": sum(
            len(item.occurrences) for item in weekly_class_occurrences
        ),
        "current_fee_rows": len(
            (await get_fee_records(db, current_period, include_future=True)).records
        ),
        "dashboard_fee_rows": dashboard.fees.record_count,
        "paid_report_receipts": paid_report.summary.receipt_count,
    }
    app_minimums = {
        "operational_class_cards": 9,
        "staff_cards": 7,
        "weekly_schedule_occurrences": 18,
        "current_fee_rows": 24,
        "dashboard_fee_rows": 24,
        "paid_report_receipts": 12,
    }
    for label, count in app_views.items():
        minimum = app_minimums[label]
        print(f"VERIFY APP VIEW {label}: {count} (minimum {minimum})")
        if count < minimum:
            failures.append(f"{label}={count}<{minimum}")
    if failures:
        raise SystemExit("Fixture verification failed: " + ", ".join(failures))


async def seed(args: argparse.Namespace) -> None:
    if args.list_workspaces:
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    text("select id, name from public.workspaces order by created_at")
                )
            ).all()
            for workspace_id, name in rows:
                print(f"{workspace_id} | {name}")
        return
    if args.workspace_id is None:
        raise SystemExit("--workspace-id is required unless --list-workspaces is used")
    if settings.app_environment == "production":
        raise SystemExit("Refusing to seed UI test data in production.")
    if is_remote_database() and not args.confirm_additive_remote:
        raise SystemExit(
            "Refusing to write to a remote database without "
            "--confirm-additive-remote. This seed is additive and workspace-scoped."
        )

    global _fixture_workspace_id
    _fixture_workspace_id = args.workspace_id
    workspace_id = str(args.workspace_id)
    token = set_workspace_id(workspace_id)
    today = args.as_of_date or date.today()
    now = datetime.now(timezone.utc)
    created: dict[str, int] = {
        "staff": 0,
        "rates": 0,
        "attendance": 0,
        "classes": 0,
        "slots": 0,
        "students": 0,
        "enrollments": 0,
        "fees": 0,
        "payments": 0,
        "fee_operations": 0,
        "fee_operation_items": 0,
        "bank_accounts": 0,
        "payment_requests": 0,
        "reconciliation": 0,
    }

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("select set_config('app.workspace_id', :workspace_id, false)"),
                {"workspace_id": workspace_id},
            )
            workspace = await db.get(Workspace, workspace_id)
            if workspace is None:
                raise SystemExit(f"Workspace {workspace_id} does not exist")
            owner = (
                await db.execute(
                    select(Profile).where(Profile.id == workspace.owner_user_id)
                )
            ).scalar_one_or_none()
            if owner is None or owner.role not in {"admin", "dev"}:
                raise SystemExit("Target workspace must have an admin/dev owner")
            if args.verify_only:
                await verify_fixture(db, workspace_id, today)
                print("VERIFY PASSED: complete UI fixture contract")
                return
            workspace_label = workspace.name
            owner_label = owner.username or owner.full_name
            owner_id = str(owner.id)

            staff_specs = [
                ("teacher", "Cô Minh Anh", "TEACHER", True),
                ("assistant", "Chị Bảo Ngọc", "ASSISTANT", True),
                ("teacher-2", "Cô Thu Hà", "TEACHER", True),
                ("teacher-3", "Thầy Quốc Hưng", "TEACHER", True),
                ("assistant-2", "Chị Mai Linh", "ASSISTANT", True),
                ("assistant-3", "Chị Thanh Thảo", "ASSISTANT", True),
                ("inactive", "Thầy Hoàng Phúc", "TEACHER", False),
            ]
            for index, (key, name, staff_type, active) in enumerate(staff_specs, 1):
                created["staff"] += await add_once(
                    db,
                    StaffMember,
                    id=fixture_id("staff", key),
                    workspace_id=workspace_id,
                    full_name=name,
                    staff_type=staff_type,
                    zalo_name=name,
                    phone=f"09080010{index:02d}",
                    email=f"ui-test-{key}@example.invalid",
                    checkin_window_after_hours=24,
                    is_active=active,
                )

            teacher_id = fixture_id("staff", "teacher")
            assistant_id = fixture_id("staff", "assistant")

            rate_id = fixture_id("rate", "teacher-current")
            created["rates"] += await add_once(
                db,
                StaffCompensationRate,
                id=rate_id,
                workspace_id=workspace_id,
                staff_id=teacher_id,
                rate_amount=180_000,
                effective_from=today - timedelta(days=180),
                effective_to=None,
                version=1,
            )
            await add_once(
                db,
                StaffCompensationRateEvent,
                id=fixture_id("rate-event", "teacher-current"),
                workspace_id=workspace_id,
                staff_id=teacher_id,
                event_type="CREATE",
                before_snapshot={},
                after_snapshot={
                    "rate_id": rate_id,
                    "rate_amount": 180_000,
                    "effective_from": (today - timedelta(days=180)).isoformat(),
                    "effective_to": None,
                    "version": 1,
                },
                actor_user_id=str(owner.id),
                reason=f"{MARKER} Mức lương dùng kiểm thử giao diện",
            )
            class_specs = [
                (
                    "current",
                    "6C1",
                    "MONTHLY",
                    850_000,
                    today - timedelta(days=75),
                    None,
                    True,
                    None,
                    schedule(("Thứ 2", "17:00", "18:30"), ("Thứ 4", "17:00", "18:30")),
                ),
                (
                    "history",
                    "5A1",
                    "COURSE",
                    2_400_000,
                    today - timedelta(days=240),
                    None,
                    False,
                    now - timedelta(days=90),
                    schedule(("Thứ 3", "19:00", "20:30"), ("Thứ 6", "19:00", "20:30")),
                ),
                (
                    "upcoming",
                    "7C2",
                    "COURSE",
                    3_600_000,
                    today + timedelta(days=21),
                    None,
                    True,
                    None,
                    schedule(
                        ("Thứ 7", "08:00", "09:30"), ("Chủ Nhật", "08:00", "09:30")
                    ),
                ),
                (
                    "cancelled",
                    "8C3",
                    "COURSE",
                    3_000_000,
                    today + timedelta(days=14),
                    None,
                    True,
                    None,
                    schedule(("Thứ 3", "08:00", "09:30"), ("Thứ 5", "08:00", "09:30")),
                ),
            ]
            historical_schedules = [
                schedule(("Thứ 2", "17:00", "18:30"), ("Thứ 4", "17:00", "18:30")),
                schedule(("Thứ 3", "17:30", "19:00"), ("Thứ 5", "17:30", "19:00")),
                schedule(("Thứ 4", "19:00", "20:30"), ("Thứ 7", "08:00", "09:30")),
            ]
            for years_ago in (1, 2, 3):
                academic_start = today.year - years_ago
                for cohort in range(1, 4):
                    start = date(academic_start, 8, 15 + cohort)
                    class_specs.append(
                        (
                            f"history-{academic_start}-{cohort}",
                            f"{4 + cohort}A{cohort}",
                            "MONTHLY" if cohort != 3 else "COURSE",
                            650_000 + (years_ago + cohort) * 50_000,
                            start,
                            None,
                            False,
                            datetime(academic_start + 1, 5, 31, tzinfo=timezone.utc),
                            historical_schedules[cohort - 1],
                        )
                    )
            # Keep the catalogue dense enough to exercise class grids,
            # scrolling, filters and the dashboard schedule without generating
            # anonymous throwaway rows.
            occupied_grades = {5, 6, 7, 8}
            for grade in range(1, 13):
                if grade in occupied_grades:
                    continue
                weekday = 2 + ((grade - 1) % 6)
                start_hour = 8 + ((grade * 2) % 11)
                class_specs.append(
                    (
                        f"grade-{grade}",
                        f"Lớp nền tảng {grade}",
                        "MONTHLY" if grade % 3 else "COURSE",
                        650_000 + grade * 50_000,
                        today - timedelta(days=30 + grade),
                        None,
                        True,
                        None,
                        schedule(
                            (
                                f"Thứ {weekday}",
                                f"{start_hour:02d}:00",
                                f"{start_hour + 1:02d}:30",
                            ),
                            (
                                f"Thứ {2 + (weekday % 6)}",
                                f"{start_hour:02d}:00",
                                f"{start_hour + 1:02d}:30",
                            ),
                        ),
                    )
                )
            for (
                key,
                name,
                class_type,
                fee,
                start,
                end,
                active,
                completed,
                class_schedule,
            ) in class_specs:
                class_id = fixture_id("class", key)
                grade_level = (
                    int(key.removeprefix("grade-"))
                    if key.startswith("grade-")
                    else 4 + int(key.rsplit("-", 1)[-1])
                    if key.startswith("history-")
                    else {
                        "current": 6,
                        "history": 5,
                        "upcoming": 7,
                        "cancelled": 8,
                    }[key]
                )
                created["classes"] += await add_once(
                    db,
                    Class,
                    id=class_id,
                    workspace_id=workspace_id,
                    name=name,
                    type=class_type,
                    base_fee=Decimal(fee),
                    billing_cycle_months=1,
                    billing_cycle_weeks=12 if class_type == "COURSE" else None,
                    start_date=start,
                    end_date=end,
                    identity_scheme="ACADEMIC_YEAR",
                    class_category="GENERAL",
                    grade_mode="GRADE",
                    program_name=None,
                    grade_level=grade_level,
                    education_level=(
                        "PRIMARY"
                        if grade_level <= 5
                        else "MIDDLE"
                        if grade_level <= 9
                        else "HIGH"
                    ),
                    academic_year_start=start.year,
                    schedule=class_schedule,
                    teacher_id=teacher_id,
                    is_active=active,
                    completed_at=None,
                    stopped_on=(completed.date() if completed else None),
                    stopped_at=completed,
                    stopped_reason=(
                        f"{MARKER} Hoàn tất năm học theo kế hoạch"
                        if completed
                        else None
                    ),
                    cancelled_at=now if key == "cancelled" else None,
                    cancelled_reason=f"{MARKER} Kịch bản lớp đã huỷ"
                    if key == "cancelled"
                    else None,
                    version=1,
                )
                if await db.get(ClassTeacher, (class_id, teacher_id)) is None:
                    db.add(
                        ClassTeacher(
                            class_id=class_id,
                            teacher_id=teacher_id,
                            workspace_id=workspace_id,
                        )
                    )
                    await db.flush()
                for slot_index, item in enumerate(class_schedule["slots"]):
                    slot_id = fixture_id("slot", f"{key}:{slot_index}")
                    created["slots"] += await add_once(
                        db,
                        ClassScheduleSlot,
                        id=slot_id,
                        workspace_id=workspace_id,
                        class_id=class_id,
                        weekday=item["day"],
                        local_start=time.fromisoformat(item["start"]),
                        local_end=time.fromisoformat(item["end"]),
                        timezone="Asia/Ho_Chi_Minh",
                        version=1,
                        effective_from=start,
                        effective_until=(completed.date() if completed else None),
                    )
                    for role, staff_id in (
                        ("TEACHER", teacher_id),
                        ("ASSISTANT", assistant_id),
                    ):
                        link_id = fixture_id("slot-staff", f"{key}:{slot_index}:{role}")
                        await add_once(
                            db,
                            ClassScheduleSlotStaff,
                            id=link_id,
                            workspace_id=workspace_id,
                            slot_id=slot_id,
                            staff_id=staff_id,
                            role=role,
                        )

            # A completed attendance row gives the staff detail, attendance
            # history and unpaid payroll balance a shared, real data source.
            occurrence_start = now - timedelta(days=2)
            occurrence_start = occurrence_start.replace(
                hour=10, minute=0, second=0, microsecond=0
            )
            attendance_id = fixture_id("attendance", "teacher-completed-session")
            created["attendance"] += await add_once(
                db,
                StaffAttendanceEntry,
                id=attendance_id,
                workspace_id=workspace_id,
                staff_id=teacher_id,
                occurrence_class_id=fixture_id("class", "current"),
                occurrence_slot_id=fixture_id("slot", "current:0"),
                occurrence_start_at=occurrence_start,
                occurrence_end_at=occurrence_start + timedelta(minutes=90),
                occurrence_kind="REGULAR",
                staff_role="TEACHER",
                scheduled_start_at=occurrence_start,
                checkin_at=occurrence_start + timedelta(minutes=3),
                rate_amount=180_000,
                rate_version=1,
                request_id=fixture_id("request", "teacher-completed-session"),
            )
            await add_once(
                db,
                StaffEarningLedgerEntry,
                id=fixture_id("earning", "teacher-completed-session"),
                workspace_id=workspace_id,
                staff_id=teacher_id,
                attendance_entry_id=attendance_id,
                entry_type="EARNING",
                amount=180_000,
                related_entry_id=None,
                reason=f"{MARKER} Buổi dạy đã chấm công",
                request_id=fixture_id("earning-request", "teacher-completed-session"),
                actor_user_id=str(owner.id),
            )

            student_specs = [
                ("unassigned", "An Nhiên", "active", "Hồ sơ chưa xếp lớp"),
                ("stopped", "Gia Hân", "inactive", "Đã ngừng học tại trung tâm"),
                (
                    "continued",
                    "Minh Khang",
                    "active",
                    "Có lịch sử lớp cũ và lớp hiện tại",
                ),
                (
                    "overdue",
                    "Khánh Linh",
                    "active",
                    "Học phí quá hạn, chưa gửi thông báo",
                ),
                (
                    "notified",
                    "Tuấn Kiệt",
                    "active",
                    "Học phí chưa nộp, đã gửi thông báo",
                ),
                ("paid-bank", "Bảo Trâm", "active", "Đã nộp bằng chuyển khoản"),
                (
                    "paid-cash",
                    "Đức Minh",
                    "active",
                    "Đã nộp tiền mặt và có giảm học phí",
                ),
                ("private", "Thảo Vy", "active", "Ẩn một số thông tin cá nhân"),
                ("archived", "Quốc Bảo", "archived", "Hồ sơ đã lưu trữ"),
            ]
            roster_names = [
                "Nguyễn Minh Anh",
                "Trần Gia Bảo",
                "Lê Hoàng Anh",
                "Phạm Khánh An",
                "Võ Ngọc Bích",
                "Đặng Tuấn Dũng",
                "Bùi Hải Đăng",
                "Đỗ Quỳnh Chi",
                "Nguyễn Đức Huy",
                "Trần Nhật Linh",
                "Lê Mai Phương",
                "Phạm Anh Khoa",
                "Võ Bảo Ngọc",
                "Đặng Minh Khôi",
                "Bùi Thanh Lam",
                "Đỗ Hà My",
                "Nguyễn Quốc Nam",
                "Trần Yến Nhi",
                "Lê Phương Thảo",
                "Phạm Gia Huy",
                "Võ Minh Triết",
                "Đặng Thùy Trang",
                "Bùi Quang Vinh",
                "Đỗ Ngọc Yến",
            ]
            student_specs.extend(
                (
                    f"roster-{index:02d}",
                    name,
                    "active",
                    "Hồ sơ học viên đang theo học tại trung tâm",
                )
                for index, name in enumerate(roster_names, 1)
            )
            for index, (key, name, status, note) in enumerate(student_specs, 1):
                created["students"] += await add_once(
                    db,
                    Student,
                    id=fixture_id("student", key),
                    workspace_id=workspace_id,
                    full_name=name,
                    birth_date=date(
                        2012 + index % 3, (index % 12) + 1, min(index + 2, 28)
                    ),
                    school=f"THCS UI Test {index}",
                    parent_name=f"Phụ huynh {name}",
                    parent_phone=f"09170010{index:02d}",
                    parent_zalo=f"PH {name}",
                    student_phone=f"09860010{index:02d}",
                    student_zalo=name,
                    notes=f"{MARKER} {note}",
                    hidden_fields=["birth_date", "student_contact"]
                    if key == "private"
                    else [],
                    status=status,
                    archived_at=now - timedelta(days=10)
                    if status == "archived"
                    else None,
                    archived_by=str(owner.id) if status == "archived" else None,
                    archived_reason=f"{MARKER} Lưu trữ để kiểm thử khôi phục"
                    if status == "archived"
                    else None,
                )

            async def enroll(
                student_key: str,
                class_key: str,
                status: str = "active",
                custom_fee=None,
            ):
                enrollment_id = fixture_id("enrollment", f"{student_key}:{class_key}")
                ended = now - timedelta(days=90) if status != "active" else None
                if class_key == "history":
                    enrollment_date = today - timedelta(days=180)
                elif class_key.startswith("history-"):
                    _, academic_year, cohort = class_key.split("-")
                    enrollment_date = date(int(academic_year), 8, 15 + int(cohort))
                    ended = datetime(int(academic_year) + 1, 5, 31, tzinfo=timezone.utc)
                elif class_key == "upcoming":
                    enrollment_date = today + timedelta(days=21)
                elif class_key.startswith("grade-"):
                    grade = int(class_key.removeprefix("grade-"))
                    enrollment_date = today - timedelta(days=30 + grade)
                else:
                    enrollment_date = today - timedelta(days=65)
                created["enrollments"] += await add_once(
                    db,
                    Enrollment,
                    id=enrollment_id,
                    workspace_id=workspace_id,
                    student_id=fixture_id("student", student_key),
                    class_id=fixture_id("class", class_key),
                    enrollment_date=enrollment_date,
                    custom_fee=Decimal(custom_fee) if custom_fee is not None else None,
                    status=status,
                    ended_at=ended,
                    end_reason="Hoàn tất lộ trình mẫu"
                    if status == "completed"
                    else None,
                )
                enrollment = await db.get(Enrollment, enrollment_id)
                if enrollment is None:
                    raise RuntimeError(f"Enrollment {enrollment_id} was not persisted")
                if enrollment.current_billing_revision_id is None:
                    await ensure_initial_billing_revision(db, enrollment)
                return enrollment_id

            await enroll("stopped", "history", "completed")
            await enroll("continued", "history", "completed")
            await enroll("continued", "upcoming", "cancelled")
            await enroll("private", "history", "dropped")
            for key in (
                "continued",
                "overdue",
                "notified",
                "paid-bank",
                "paid-cash",
                "private",
            ):
                await enroll(
                    key, "current", custom_fee=700_000 if key == "paid-cash" else None
                )
            for index in range(1, 25):
                student_key = f"roster-{index:02d}"
                class_key = (
                    "current" if index <= 8 else f"grade-{((index - 1) % 12) + 1}"
                )
                if class_key in {
                    "grade-3",
                    "grade-5",
                    "grade-6",
                    "grade-7",
                    "grade-8",
                    "grade-9",
                    "grade-12",
                }:
                    class_key = "current"
                await enroll(student_key, class_key)
                # Học viên lâu năm có các ghi danh đã hoàn tất ở những năm học
                # trước, tạo lịch sử học tập thực tế thay vì các thẻ rời rạc.
                if index <= 18:
                    years_ago = 1 + ((index - 1) % 3)
                    cohort = 1 + ((index - 1) % 3)
                    await enroll(
                        student_key,
                        f"history-{today.year - years_ago}-{cohort}",
                        "completed",
                    )

            fee_specs = [
                ("overdue", -18, "UNPAID", False, 850_000, 0, None),
                ("notified", 5, "UNPAID", True, 850_000, 0, None),
                ("paid-bank", -2, "PAID", True, 850_000, 0, "bank_transfer"),
                ("paid-cash", 8, "PAID", True, 700_000, 50_000, "cash"),
                ("private", 15, "UNPAID", False, 850_000, 100_000, None),
            ]
            for (
                student_key,
                due_offset,
                status,
                notified,
                amount,
                discount,
                method,
            ) in fee_specs:
                fee_id = fixture_id("fee", student_key)
                enrollment_id = fixture_id("enrollment", f"{student_key}:current")
                final_amount = amount - discount
                fee_created = await add_once(
                    db,
                    FeeRecord,
                    id=fee_id,
                    workspace_id=workspace_id,
                    enrollment_id=enrollment_id,
                    period=f"{today.year}-{today.month:02d}",
                    due_date=today + timedelta(days=due_offset),
                    cycle_no=0,
                    base_due_date=today + timedelta(days=due_offset),
                    adjusted_due_date=today + timedelta(days=due_offset),
                    coverage_start=today.replace(day=1),
                    coverage_end=(today.replace(day=28) + timedelta(days=4)).replace(
                        day=1
                    )
                    - timedelta(days=1),
                    origin="ENROLLMENT",
                    enrollment_date_snapshot=today - timedelta(days=65),
                    student_name_snapshot=next(
                        item[1] for item in student_specs if item[0] == student_key
                    ),
                    class_name_snapshot="6C1",
                    class_type_snapshot="MONTHLY",
                    billing_cycle_months_snapshot=1,
                    base_amount=Decimal(amount),
                    discount_amount=Decimal(discount),
                    discount_reason="Ưu đãi dữ liệu UI" if discount else None,
                    status=status,
                    notified_at=now - timedelta(days=1) if notified else None,
                    notification_channel="zalo_copy" if notified else None,
                    notification_message="Thông báo học phí dữ liệu UI"
                    if notified
                    else None,
                    paid_amount=Decimal(final_amount) if status == "PAID" else None,
                    paid_date=today if status == "PAID" else None,
                    refunded_amount=Decimal(0),
                    note=f"{MARKER} Kịch bản {student_key}",
                )
                created["fees"] += fee_created
                if method:
                    payment_id = fixture_id("payment", student_key)
                    created["payments"] += await add_once(
                        db,
                        Payment,
                        id=payment_id,
                        workspace_id=workspace_id,
                        fee_record_id=fee_id,
                        amount=Decimal(final_amount),
                        payment_date=today,
                        payment_method=method,
                        entry_type="payment",
                        note=f"{MARKER} Thanh toán mẫu",
                        created_by=str(owner.id),
                        payment_origin="manual",
                    )
                    enrollment = await db.get(Enrollment, enrollment_id)
                    student = await db.get(Student, fixture_id("student", student_key))
                    class_row = await db.get(Class, fixture_id("class", "current"))
                    if enrollment is None or student is None or class_row is None:
                        raise RuntimeError("Demo receipt lost its business entities")
                    operation_created, item_created = await add_payment_receipt(
                        db,
                        workspace_id=workspace_id,
                        payment_id=payment_id,
                        fee_record_id=fee_id,
                        enrollment=enrollment,
                        student=student,
                        class_row=class_row,
                        period=f"{today:%Y-%m}",
                        due_date=today + timedelta(days=due_offset),
                        paid_on=today,
                        amount=final_amount,
                        payment_method=method,
                        owner=owner,
                    )
                    created["fee_operations"] += operation_created
                    created["fee_operation_items"] += item_created

            # Twelve recent monthly periods provide realistic fee timelines,
            # reports and cash-flow charts for the long-running centre.
            student_name_by_key = {item[0]: item[1] for item in student_specs}
            for index in range(1, 25):
                student_key = f"roster-{index:02d}"
                class_key = (
                    "current" if index <= 8 else f"grade-{((index - 1) % 12) + 1}"
                )
                if class_key in {
                    "grade-3",
                    "grade-5",
                    "grade-6",
                    "grade-7",
                    "grade-8",
                    "grade-9",
                    "grade-12",
                }:
                    class_key = "current"
                enrollment_id = fixture_id("enrollment", f"{student_key}:{class_key}")
                enrollment = await db.get(Enrollment, enrollment_id)
                student = await db.get(Student, fixture_id("student", student_key))
                class_row = await db.get(Class, fixture_id("class", class_key))
                if enrollment is None or student is None or class_row is None:
                    raise RuntimeError("Demo fee timeline lost its enrollment or class")
                next_cycle_no = int(
                    await db.scalar(
                        text(
                            "select coalesce(max(cycle_no), -1) + 1 "
                            "from public.fee_records where enrollment_id=:enrollment_id"
                        ),
                        {"enrollment_id": enrollment_id},
                    )
                    or 0
                )
                for month_offset in range(-11, 1):
                    period_date = shift_month(today.replace(day=1), month_offset)
                    next_period = shift_month(period_date, 1)
                    is_current = month_offset == 0
                    # The current demo period must already be actionable on the
                    # selected business date; otherwise dashboard, fee and
                    # report screens look empty during the first days of a month.
                    due_date = (
                        period_date if is_current else period_date + timedelta(days=4)
                    )
                    status = "UNPAID" if is_current and index % 4 in {0, 1} else "PAID"
                    notified = status == "PAID" or (is_current and index % 4 == 0)
                    amount = int(class_row.base_fee)
                    fee_id = fixture_id(
                        "fee-timeline", f"{student_key}:{period_date:%Y-%m}"
                    )
                    existing_fee = await db.get(FeeRecord, fee_id)
                    paid_on = min(due_date + timedelta(days=index % 4), today)
                    # When the fixture advances to a new business month, close
                    # the previous demo month's intentionally unpaid examples.
                    # Keep the newly-current period mixed so every fee state is
                    # still available for UI testing.
                    if (
                        existing_fee is not None
                        and not is_current
                        and existing_fee.status == "UNPAID"
                    ):
                        existing_fee.status = "PAID"
                        existing_fee.paid_amount = Decimal(amount)
                        existing_fee.paid_date = paid_on
                    if existing_fee is not None and is_current:
                        existing_fee.due_date = due_date
                        existing_fee.base_due_date = due_date
                        existing_fee.adjusted_due_date = due_date
                        if existing_fee.status == "PAID":
                            existing_fee.paid_date = paid_on
                    cycle_no = (
                        int(existing_fee.cycle_no)
                        if existing_fee is not None
                        else next_cycle_no
                    )
                    if existing_fee is None:
                        next_cycle_no += 1
                    created["fees"] += await add_once(
                        db,
                        FeeRecord,
                        id=fee_id,
                        workspace_id=workspace_id,
                        enrollment_id=enrollment_id,
                        billing_revision_id=enrollment.current_billing_revision_id,
                        period=f"{period_date:%Y-%m}",
                        due_date=due_date,
                        cycle_no=cycle_no,
                        anchor_cycle_no=cycle_no,
                        base_due_date=due_date,
                        adjusted_due_date=due_date,
                        coverage_start=period_date,
                        coverage_end=next_period - timedelta(days=1),
                        origin="ENROLLMENT",
                        enrollment_date_snapshot=enrollment.enrollment_date,
                        student_name_snapshot=student_name_by_key[student_key],
                        class_name_snapshot=class_row.name,
                        class_type_snapshot=class_row.type,
                        billing_cycle_months_snapshot=1,
                        base_amount=Decimal(amount),
                        discount_amount=Decimal(0),
                        status=status,
                        notified_at=(now - timedelta(days=max(1, -month_offset * 28)))
                        if notified
                        else None,
                        notification_channel="zalo_copy" if notified else None,
                        notification_message="Thông báo học phí định kỳ"
                        if notified
                        else None,
                        paid_amount=Decimal(amount) if status == "PAID" else None,
                        paid_date=paid_on if status == "PAID" else None,
                        refunded_amount=Decimal(0),
                        note=f"{MARKER} Lịch sử thu học phí định kỳ",
                    )
                    if status == "PAID":
                        payment_id = fixture_id(
                            "payment-timeline",
                            f"{student_key}:{period_date:%Y-%m}",
                        )
                        created["payments"] += await add_once(
                            db,
                            Payment,
                            id=payment_id,
                            workspace_id=workspace_id,
                            fee_record_id=fee_id,
                            amount=Decimal(amount),
                            payment_date=paid_on,
                            payment_method="bank_transfer" if index % 3 else "cash",
                            entry_type="payment",
                            note=f"{MARKER} Thanh toán học phí định kỳ",
                            created_by=str(owner.id),
                            payment_origin="manual",
                        )
                        operation_created, item_created = await add_payment_receipt(
                            db,
                            workspace_id=workspace_id,
                            payment_id=payment_id,
                            fee_record_id=fee_id,
                            enrollment=enrollment,
                            student=student,
                            class_row=class_row,
                            period=f"{period_date:%Y-%m}",
                            due_date=due_date,
                            paid_on=paid_on,
                            amount=amount,
                            payment_method=("bank_transfer" if index % 3 else "cash"),
                            owner=owner,
                        )
                        created["fee_operations"] += operation_created
                        created["fee_operation_items"] += item_created

            # One unmatched incoming transfer keeps the reconciliation tab
            # testable without calling or impersonating the Pay2S API.
            account_id = fixture_id("bank-account", "tuition")
            created["bank_accounts"] += await add_once(
                db,
                WorkspacePaymentAccount,
                id=account_id,
                workspace_id=workspace_id,
                label="Tài khoản thu học phí",
                bank_code="VCB",
                bank_name="Vietcombank",
                account_number="0123456789",
                account_name="TPRO ENGLISH",
                provider_status="manual",
                provider_metadata={"fixture": True},
                is_default=True,
                is_active=True,
                created_by=owner_id,
                updated_by=owner_id,
            )
            account_id = await db.scalar(
                text(
                    "select id from public.workspace_payment_accounts "
                    "where workspace_id = :workspace_id and is_active is true "
                    "order by is_default desc, created_at limit 1"
                ),
                {"workspace_id": workspace_id},
            )

            overdue_student = await db.get(Student, fixture_id("student", "overdue"))
            if overdue_student is None or overdue_student.student_code is None:
                raise RuntimeError("Overdue student must have a generated student code")
            payment_request_id = fixture_id("payment-request", "overdue-open")
            request_created = await add_once(
                db,
                PaymentRequest,
                id=payment_request_id,
                workspace_id=workspace_id,
                request_id=fixture_id("payment-request-command", "overdue-open"),
                fee_record_id=fixture_id("fee", "overdue"),
                enrollment_id=fixture_id("enrollment", "overdue:current"),
                student_code_snapshot=overdue_student.student_code,
                payment_reference=(
                    f"TP{''.join(character for character in overdue_student.student_code if character.isdigit())}"
                    "PDATA2026"
                ),
                expected_amount=Decimal(850_000),
                currency="VND",
                status="OPEN",
                expires_at=now + timedelta(days=7),
                provider="manual",
                provider_metadata={"fixture": True},
                settlement_account_id=account_id,
                created_by=owner_id,
                sent_at=now - timedelta(hours=2),
                sent_channel="zalo_manual",
                send_count=1,
                early_payment=False,
            )
            await add_once(
                db,
                PaymentRequestItem,
                id=fixture_id("payment-request-item", "overdue-open"),
                workspace_id=workspace_id,
                payment_request_id=payment_request_id,
                fee_record_id=fixture_id("fee", "overdue"),
                enrollment_id=fixture_id("enrollment", "overdue:current"),
                student_code_snapshot=overdue_student.student_code,
                class_name_snapshot="6C1",
                cycle_no=0,
                base_due_date=today - timedelta(days=18),
                adjusted_due_date=today - timedelta(days=18),
                expected_amount=Decimal(850_000),
            )
            await add_once(
                db,
                PaymentRequestEvent,
                id=fixture_id("payment-request-event", "overdue-open-created"),
                workspace_id=workspace_id,
                payment_request_id=payment_request_id,
                event_type="CREATED",
                old_status=None,
                new_status="OPEN",
                actor_user_id=owner_id,
                idempotency_key=fixture_id(
                    "payment-request-event-command", "overdue-open-created"
                ),
                event_metadata={"fixture": True},
            )
            created["payment_requests"] += request_created
            delivery_id = fixture_id("provider-delivery", "amount-mismatch")
            provider_transaction_id = f"UI-TEST-{workspace_id[:8]}-UNMATCHED"
            delivery_result = await db.execute(
                text(
                    "insert into public.payment_provider_deliveries "
                    "(id, provider, provider_event_id, provider_transaction_id, payload_hash, "
                    " raw_payload_hash, status, workspace_id) "
                    "values (:id, 'pay2s', :event_id, :transaction_id, :payload_hash, "
                    " :payload_hash, 'PROCESSED', :workspace_id) "
                    "on conflict (id) do nothing"
                ),
                {
                    "id": delivery_id,
                    "event_id": f"ui-test-{delivery_id}",
                    "transaction_id": provider_transaction_id,
                    "payload_hash": fixture_id("payload", "amount-mismatch").replace(
                        "-", ""
                    ),
                    "workspace_id": workspace_id,
                },
            )
            queue_result = await db.execute(
                text(
                    "insert into public.payment_posting_queue "
                    "(id, delivery_id, status, review_reason, attempts, workspace_id, transaction_snapshot) "
                    "values (:id, :delivery_id, 'REVIEW', 'AMOUNT_MISMATCH', 1, :workspace_id, "
                    " cast(:snapshot as jsonb)) on conflict (id) do nothing"
                ),
                {
                    "id": fixture_id("posting-queue", "amount-mismatch"),
                    "delivery_id": delivery_id,
                    "workspace_id": workspace_id,
                    "snapshot": (
                        '{"provider_transaction_id":"' + provider_transaction_id + '",'
                        '"source":"ui_test","bank_account_id":'
                        + (f'"{account_id}"' if account_id else "null")
                        + ',"bank_name":"VCB","account_number":"0000000016",'
                        '"transfer_type":"IN","amount":123456,'
                        '"content":"UI TEST KHONG KHOP NOI DUNG",'
                        f'"transaction_date":"{today.isoformat()}","result_code":"0"}}'
                    ),
                },
            )
            if delivery_result.rowcount or queue_result.rowcount:
                created["reconciliation"] = 1

            if args.dry_run:
                await db.rollback()
                result = "DRY RUN (rolled back)"
            else:
                await db.commit()
                # Use the real command services for append-only financial
                # histories; this keeps projections and audit ledgers aligned.
                postponement_request_id = fixture_id("makeup-request", "pending")
                postponement_note = f"{MARKER} Buổi học đã được hoãn"
                postponement_exists = await db.scalar(
                    text(
                        "select 1 from public.class_schedule_adjustments "
                        "where request_id = :request_id limit 1"
                    ),
                    {"request_id": postponement_request_id},
                )
                if postponement_exists is None:
                    days_until_monday = (7 - today.weekday()) % 7 or 7
                    original_local = datetime.combine(
                        today + timedelta(days=days_until_monday),
                        time(17, 0),
                        tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"),
                    )
                    await create_postponement(
                        db,
                        UUID(fixture_id("class", "current")),
                        PostponementCreateRequest(
                            original_start_at=[original_local.astimezone(timezone.utc)],
                            reason_code="OTHER",
                            reason_note=postponement_note,
                            request_id=UUID(postponement_request_id),
                        ),
                        actor_user_id=owner_id,
                    )
                else:
                    await db.execute(
                        text(
                            "update public.class_schedule_adjustments "
                            "set reason_note = :reason_note "
                            "where request_id = :request_id"
                        ),
                        {
                            "reason_note": postponement_note,
                            "request_id": postponement_request_id,
                        },
                    )
                    await db.commit()
                await refund_fee_records(
                    db,
                    FeeBatchRefundRequest(
                        items=[
                            FeeRefundItem(
                                record_id=UUID(fixture_id("fee", "paid-bank")),
                                amount=100_000,
                            )
                        ],
                        reason=f"{MARKER} Hoàn phí một phần",
                        refund_method="cash",
                        request_id=UUID(fixture_id("refund-request", "partial")),
                    ),
                    actor_id=owner_id,
                )
                settlement = await settle_staff_payroll(
                    db,
                    UUID(teacher_id),
                    StaffPayrollSettlementCreate(
                        request_id=UUID(fixture_id("payroll-request", "settled")),
                        method="cash",
                        reference="UI-TEST-PAYROLL",
                        reason=f"{MARKER} Tất toán mẫu",
                    ),
                    actor_user_id=owner_id,
                )
                await reverse_staff_payroll_settlement(
                    db,
                    UUID(teacher_id),
                    settlement.id,
                    StaffPayrollSettlementReversalCreate(
                        request_id=UUID(fixture_id("payroll-request", "reversed")),
                        reason=f"{MARKER} Hoàn tác tất toán để kiểm thử",
                    ),
                    actor_user_id=owner_id,
                )
                result = "COMMITTED"
            print(f"{result}: workspace={workspace_label} owner={owner_label}")
            print(
                "Created: "
                + ", ".join(f"{key}={value}" for key, value in created.items())
            )
            print(f"Fixture marker: {MARKER}")
    finally:
        reset_workspace_id(token)


if __name__ == "__main__":
    asyncio.run(seed(parse_args()))
