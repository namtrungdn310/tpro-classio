"""Canonical billing decision service for class and student start date changes.

Calculates preview impact and evaluates explicit billing strategies:
1. KEEP_EXISTING_SCHEDULE
2. KEEP_CURRENT_THEN_REANCHOR
3. REANCHOR_CURRENT_CYCLE
4. REANCHOR_NEXT_BOUNDARY
5. REANCHOR_CUSTOM_BOUNDARY
"""

from datetime import date
from typing import Sequence


from app.core.billing_schedule import (
    COURSE,
    add_months_clamped,
    course_cycle_containing,
    cycle_base_due_date,
    cycle_coverage_interval,
    first_course_cycle_on_or_after,
    first_monthly_cycle_on_or_after,
)
from app.core.business_time import business_today
from app.models.fee_record import FeeRecord
from app.schemas.billing_decision import (
    BillingCycleOption,
    BillingDecisionCode,
    BillingDecisionOption,
)
from app.services.fee_reconciliation import is_fee_record_mutable, is_fee_record_protected


def cycle_covering_date(
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    target_date: date,
) -> int:
    """Return the 0-based cycle index whose coverage covers target_date."""
    if anchor >= target_date:
        return 0
    if billing_type == COURSE:
        weeks = max(int(cycle_weeks or 1), 1)
        return course_cycle_containing(anchor, weeks, target_date)
    # MONTHLY
    months = max(0, (target_date.year - anchor.year) * 12 + target_date.month - anchor.month)
    if add_months_clamped(anchor, months) > target_date:
        months = max(0, months - 1)
    return months


def next_canonical_cycle_on_or_after(
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    floor_date: date,
) -> int:
    """Return the first cycle whose coverage start is >= floor_date."""
    if anchor >= floor_date:
        return 0
    if billing_type == COURSE:
        weeks = max(int(cycle_weeks or 1), 1)
        return first_course_cycle_on_or_after(anchor, weeks, floor_date)
    return first_monthly_cycle_on_or_after(anchor, floor_date)


def generate_available_cycles(
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    effective_fee: int,
    limit: int = 12,
) -> list[BillingCycleOption]:
    """Generate canonical cycles starting from cycle 0 for up to limit cycles."""
    cycles: list[BillingCycleOption] = []
    for c in range(limit):
        c_start, c_end = cycle_coverage_interval(anchor, billing_type, cycle_weeks, c)
        c_due = cycle_base_due_date(anchor, billing_type, cycle_weeks, c)
        cycles.append(
            BillingCycleOption(
                cycle_no=c,
                due_date=c_due,
                coverage_start=c_start,
                coverage_end=c_end,
                amount=effective_fee,
                label=f"Kỳ {c + 1} ({c_start.strftime('%d/%m/%Y')} - {c_end.strftime('%d/%m/%Y')})",
            )
        )
    return cycles


def compute_billing_decisions_for_enrollment(
    *,
    old_enrollment_date: date,
    new_enrollment_date: date,
    billing_type: str,
    cycle_weeks: int | None,
    effective_fee: int,
    fee_records: Sequence[FeeRecord],
    open_payment_request_count: int = 0,
    today: date | None = None,
    is_new_enrollment: bool = False,
) -> list[BillingDecisionOption]:
    """Pure domain calculation of the 5 canonical billing strategies."""
    if today is None:
        today = business_today()

    active_fees = [f for f in fee_records if f.status not in ("VOID", "SUPERSEDED")]
    protected_fees = [f for f in active_fees if is_fee_record_protected(f)]
    mutable_fees = [f for f in active_fees if is_fee_record_mutable(f)]

    # Protected coverage ceiling
    protected_through: date | None = None
    if protected_fees:
        valid_ends = [f.coverage_end for f in protected_fees if f.coverage_end]
        if valid_ends:
            protected_through = max(valid_ends)

    # Has any payment or notice occurred on the current or upcoming cycle?
    current_or_future_protected = [
        f for f in protected_fees
        if f.coverage_end is None or f.coverage_end >= today
    ]
    has_current_protected = len(current_or_future_protected) > 0

    decisions: list[BillingDecisionOption] = []

    # 1. KEEP_EXISTING_SCHEDULE
    # Only applicable for existing enrollments where old schedule can be maintained.
    can_keep_existing = not is_new_enrollment and (
        new_enrollment_date <= old_enrollment_date
        or (protected_through is not None and new_enrollment_date <= protected_through)
    )
    disabled_reason_keep = None
    if is_new_enrollment:
        disabled_reason_keep = "Học viên mới chưa có lịch thu trước đó"
    elif not can_keep_existing:
        disabled_reason_keep = (
            "Không thể giữ lịch cũ khi ngày mới dời muộn hơn mốc bắt đầu của kỳ hiện tại"
        )

    old_anchor = old_enrollment_date
    c_exist = cycle_covering_date(old_anchor, billing_type, cycle_weeks, today)
    c_exist_start, c_exist_end = cycle_coverage_interval(old_anchor, billing_type, cycle_weeks, c_exist)
    c_exist_due = cycle_base_due_date(old_anchor, billing_type, cycle_weeks, c_exist)

    decisions.append(
        BillingDecisionOption(
            decision_code=BillingDecisionCode.KEEP_EXISTING_SCHEDULE,
            label="Giữ nguyên lịch thu hiện tại",
            description=(
                "Chỉ cập nhật ngày bắt đầu của học viên; giữ nguyên toàn bộ chu kỳ, "
                "mốc tính và các hạn thu phí đã xếp."
            ),
            first_anchor_cycle_no=c_exist,
            due_date=c_exist_due,
            coverage_start=c_exist_start,
            coverage_end=c_exist_end,
            amount=effective_fee,
            kept_fee_count=len(active_fees),
            superseded_fee_count=0,
            skipped_cycle_count=0,
            protected_fee_count=len(protected_fees),
            revoked_payment_request_count=0,
            review_required=False,
            allowed=can_keep_existing,
            recommended=can_keep_existing and not has_current_protected and new_enrollment_date <= old_enrollment_date,
            disabled_reason=disabled_reason_keep,
        )
    )

    # 2. KEEP_CURRENT_THEN_REANCHOR
    # Keep protected records. Supersede future mutables. Start new anchor after protected coverage.
    floor_for_next = max(today, protected_through) if protected_through else today
    c_then_reanchor = next_canonical_cycle_on_or_after(new_enrollment_date, billing_type, cycle_weeks, floor_for_next)
    c_tr_start, c_tr_end = cycle_coverage_interval(new_enrollment_date, billing_type, cycle_weeks, c_then_reanchor)
    c_tr_due = cycle_base_due_date(new_enrollment_date, billing_type, cycle_weeks, c_then_reanchor)

    # Future mutables starting on or after protected_through will be superseded
    superseded_in_tr = [
        f for f in mutable_fees
        if protected_through is None or (f.coverage_start and f.coverage_start >= protected_through)
    ]
    kept_in_tr = len(active_fees) - len(superseded_in_tr)

    decisions.append(
        BillingDecisionOption(
            decision_code=BillingDecisionCode.KEEP_CURRENT_THEN_REANCHOR,
            label="Giữ kỳ hiện tại, chuyển lịch từ kỳ kế tiếp",
            description=(
                "Bảo vệ kỳ thu hiện tại và các khoản đã thanh toán/đã báo. "
                f"Lịch mới sẽ bắt đầu từ kỳ có mốc {c_tr_start.strftime('%d/%m/%Y')}."
            ),
            first_anchor_cycle_no=c_then_reanchor,
            due_date=c_tr_due,
            coverage_start=c_tr_start,
            coverage_end=c_tr_end,
            amount=effective_fee,
            kept_fee_count=kept_in_tr,
            superseded_fee_count=len(superseded_in_tr),
            skipped_cycle_count=c_then_reanchor,
            protected_fee_count=len(protected_fees),
            revoked_payment_request_count=open_payment_request_count if superseded_in_tr else 0,
            review_required=False,
            allowed=True,
            recommended=has_current_protected,
            disabled_reason=None,
        )
    )

    # 3. REANCHOR_CURRENT_CYCLE
    # Recalculates from new_enrollment_date and takes the cycle covering business today.
    c_curr = cycle_covering_date(new_enrollment_date, billing_type, cycle_weeks, today)
    c_curr_start, c_curr_end = cycle_coverage_interval(new_enrollment_date, billing_type, cycle_weeks, c_curr)
    c_curr_due = cycle_base_due_date(new_enrollment_date, billing_type, cycle_weeks, c_curr)

    is_future_start = new_enrollment_date > today
    can_reanchor_curr = not is_future_start or c_curr == 0
    curr_warning = " (khoản thu sẽ quá hạn ngay khi tạo)" if c_curr_due < today else ""

    decisions.append(
        BillingDecisionOption(
            decision_code=BillingDecisionCode.REANCHOR_CURRENT_CYCLE,
            label="Tính lại từ kỳ đang học hiện tại",
            description=(
                f"Tạo kỳ thu bao phủ ngày hôm nay: từ {c_curr_start.strftime('%d/%m/%Y')} "
                f"đến {c_curr_end.strftime('%d/%m/%Y')}{curr_warning}."
            ),
            first_anchor_cycle_no=c_curr,
            due_date=c_curr_due,
            coverage_start=c_curr_start,
            coverage_end=c_curr_end,
            amount=effective_fee,
            kept_fee_count=len(protected_fees),
            superseded_fee_count=len(mutable_fees),
            skipped_cycle_count=c_curr,
            protected_fee_count=len(protected_fees),
            revoked_payment_request_count=open_payment_request_count if mutable_fees else 0,
            review_required=c_curr_due < today or has_current_protected,
            allowed=can_reanchor_curr,
            recommended=not has_current_protected and not is_future_start and c_curr_due >= today,
            disabled_reason="Ngày bắt đầu ở tương lai; kỳ thu đầu tiên bắt đầu từ ngày nhập học" if not can_reanchor_curr else None,
        )
    )

    # 4. REANCHOR_NEXT_BOUNDARY
    # Skip past uncharged cycles, start at first boundary >= today
    c_next = next_canonical_cycle_on_or_after(new_enrollment_date, billing_type, cycle_weeks, today)
    # If today matches start date exactly or start date is in future, c_next is 0 or 1
    if is_future_start:
        c_next = 0
    elif c_next == 0 and new_enrollment_date < today:
        c_next = 1

    c_next_start, c_next_end = cycle_coverage_interval(new_enrollment_date, billing_type, cycle_weeks, c_next)
    c_next_due = cycle_base_due_date(new_enrollment_date, billing_type, cycle_weeks, c_next)

    decisions.append(
        BillingDecisionOption(
            decision_code=BillingDecisionCode.REANCHOR_NEXT_BOUNDARY,
            label="Bắt đầu thu từ kỳ kế tiếp",
            description=(
                f"Bỏ qua các kỳ trước; kỳ thu tiếp theo bắt đầu từ {c_next_start.strftime('%d/%m/%Y')} "
                f"(hạn thu {c_next_due.strftime('%d/%m/%Y')}). Không truy thu nợ cũ."
            ),
            first_anchor_cycle_no=c_next,
            due_date=c_next_due,
            coverage_start=c_next_start,
            coverage_end=c_next_end,
            amount=effective_fee,
            kept_fee_count=len(protected_fees),
            superseded_fee_count=len(mutable_fees),
            skipped_cycle_count=c_next,
            protected_fee_count=len(protected_fees),
            revoked_payment_request_count=open_payment_request_count if mutable_fees else 0,
            review_required=False,
            allowed=True,
            recommended=not has_current_protected and (new_enrollment_date < today or is_future_start),
            disabled_reason=None,
        )
    )

    # 5. REANCHOR_CUSTOM_BOUNDARY
    # Allow admin to choose from list of canonical cycles
    available_cycles = generate_available_cycles(
        new_enrollment_date, billing_type, cycle_weeks, effective_fee, limit=12
    )

    decisions.append(
        BillingDecisionOption(
            decision_code=BillingDecisionCode.REANCHOR_CUSTOM_BOUNDARY,
            label="Chọn kỳ thu tùy chỉnh",
            description=(
                "Chọn mốc kỳ thu cụ thể từ danh sách kỳ hợp lệ của lớp. "
                "Có thể chọn thêm kỳ lịch sử muốn truy thu trong phần nâng cao."
            ),
            first_anchor_cycle_no=c_next,
            due_date=c_next_due,
            coverage_start=c_next_start,
            coverage_end=c_next_end,
            amount=effective_fee,
            kept_fee_count=len(protected_fees),
            superseded_fee_count=len(mutable_fees),
            skipped_cycle_count=c_next,
            protected_fee_count=len(protected_fees),
            revoked_payment_request_count=open_payment_request_count if mutable_fees else 0,
            review_required=True,
            allowed=True,
            recommended=False,
            disabled_reason=None,
            available_cycles=available_cycles,
        )
    )

    # Ensure exactly one option is recommended
    has_rec = any(d.recommended for d in decisions if d.allowed)
    if not has_rec:
        for d in decisions:
            if d.decision_code == BillingDecisionCode.REANCHOR_NEXT_BOUNDARY and d.allowed:
                d.recommended = True
                break

    return decisions
