"""Immutable financial change plans, shared by preview and execution.

Academic dates deliberately do not occur in this module. A caller supplies the
agreed billing scope, an authoritative snapshot and an explicit decision. The
executor must re-plan under lock and compare fingerprints before any writes.
Intervals are half-open; no plan mutates a paid/notified financial document.
"""

from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
from typing import Literal

from app.core.billing_schedule import add_months_clamped, cycle_coverage_interval

PLAN_VERSION = 3


class BillingPlanError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, order=True)
class Interval:
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise BillingPlanError("INVALID_COVERAGE", "Khoảng kỳ thu không hợp lệ")

    def overlaps(self, other: "Interval") -> bool:
        return self.start < other.end and other.start < self.end


def uncovered_intervals(
    scope: Interval, covered: tuple[Interval, ...]
) -> tuple[Interval, ...]:
    """Subtract the union, not just the latest end (prepaid periods may have gaps)."""
    cursor = scope.start
    gaps: list[Interval] = []
    for span in sorted(covered):
        if span.end <= cursor or span.start >= scope.end:
            continue
        if span.start > cursor:
            gaps.append(Interval(cursor, min(span.start, scope.end)))
        cursor = min(scope.end, max(cursor, span.end))
        if cursor == scope.end:
            break
    if cursor < scope.end:
        gaps.append(Interval(cursor, scope.end))
    return tuple(gaps)


@dataclass(frozen=True)
class FeeSnapshot:
    id: str
    coverage: Interval | None
    amount: int
    status: str
    protected: bool
    # Includes payment/request/review versions, not merely the fee's status.
    financial_version: str
    has_settlement: bool = False
    billing_revision_id: str | None = None
    review_required: bool = False
    is_paid: bool = False
    notified: bool = False

    @property
    def active(self) -> bool:
        return self.status not in ("VOID", "SUPERSEDED")


@dataclass(frozen=True)
class PlannedCharge:
    coverage: Interval
    due_date: date
    amount: int
    cycle_no: int | None
    kind: Literal["CYCLE", "TRANSITION", "OLD_SCHEDULE_CYCLE"] = "CYCLE"
    anchor_date: date | None = None
    billing_type: str | None = None
    cycle_weeks: int | None = None


@dataclass(frozen=True)
class ScheduledSegment:
    """An old schedule retained until cutover, not pre-created invoices."""

    coverage: Interval
    anchor: date
    billing_type: str
    cycle_weeks: int | None
    amount: int


@dataclass(frozen=True)
class BillingChangePlan:
    enrollment_id: str
    version: int
    business_date: date
    anchor: date
    billing_type: str
    cycle_weeks: int | None
    first_cycle: int
    keep_ids: tuple[str, ...]
    supersede_ids: tuple[str, ...]
    charges: tuple[PlannedCharge, ...]
    waived_intervals: tuple[Interval, ...]
    gap_intervals: tuple[Interval, ...]
    source_digest: str
    reason: str
    policy_version: int = PLAN_VERSION
    scheduled_segments: tuple[ScheduledSegment, ...] = ()
    retained_waived_intervals: tuple[Interval, ...] = ()
    replaced_waived_intervals: tuple[Interval, ...] = ()
    suspension_adjustment: dict | None = None

    @property
    def can_apply(self) -> bool:
        return not self.gap_intervals

    @property
    def fingerprint(self) -> str:
        return _digest(asdict(self))


def _digest(value: object) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def price_transition(
    span: Interval,
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    amount: int,
) -> int:
    """Prorate each canonical period separately, round once for the interval.

    Negative ordinals describe an agreed bridge before the new anchor; they
    do not create historical invoices or change the recurring generation floor.
    """
    if billing_type == "COURSE":
        days = int(cycle_weeks or 1) * 7
        total = Decimal(amount) * (span.end - span.start).days / days
    else:
        ordinal = (span.start.year - anchor.year) * 12 + span.start.month - anchor.month
        if add_months_clamped(anchor, ordinal) > span.start:
            ordinal -= 1
        cursor = span.start
        total = Decimal(0)
        while cursor < span.end:
            period_start = add_months_clamped(anchor, ordinal)
            period_end = add_months_clamped(anchor, ordinal + 1)
            end = min(period_end, span.end)
            total += (
                Decimal(amount) * (end - cursor).days / (period_end - period_start).days
            )
            cursor = end
            ordinal += 1
    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_billing_change_plan(
    *,
    enrollment_id: str,
    version: int,
    business_date: date,
    anchor: date,
    billing_type: str,
    cycle_weeks: int | None,
    amount: int,
    first_cycle: int,
    transition_from: date,
    fees: tuple[FeeSnapshot, ...],
    replacement_fee_ids: tuple[str, ...] = (),
    historical_cycles: tuple[int, ...] = (),
    gap_policy: Literal["REVIEW", "CHARGE", "WAIVE"] = "REVIEW",
    reason: str = "",
    old_schedule_charges: tuple[PlannedCharge, ...] = (),
    transition_anchor: date | None = None,
    transition_billing_type: str | None = None,
    transition_cycle_weeks: int | None = None,
    custom_transition_amount: int | None = None,
    scheduled_segments: tuple[ScheduledSegment, ...] = (),
    excluded_intervals: tuple[Interval, ...] = (),
) -> BillingChangePlan:
    """Price exactly the selected scope; never infer debt removal from a date.

    The new recurring schedule starts at ``first_cycle``. Older cycles only
    materialise when explicitly selected. A retained future fee blocks the new
    schedule even if it does not overlap its first invoice: otherwise a later
    worker would eventually double-charge it.
    """
    if billing_type not in ("MONTHLY", "COURSE"):
        raise BillingPlanError("INVALID_CADENCE", "Loại kỳ thu không hợp lệ")
    if billing_type == "COURSE" and (cycle_weeks is None or cycle_weeks < 1):
        raise BillingPlanError("INVALID_CADENCE", "Thời lượng gói phải lớn hơn 0")
    if first_cycle < 0 or amount < 0 or version < 0:
        raise BillingPlanError("INVALID_PLAN", "Dữ liệu kỳ thu không hợp lệ")
    if gap_policy not in ("REVIEW", "CHARGE", "WAIVE"):
        raise BillingPlanError(
            "INVALID_GAP_POLICY", "Phương án kỳ chuyển tiếp không hợp lệ"
        )
    reason = " ".join(reason.split())
    if gap_policy != "REVIEW" and len(reason) < 3:
        raise BillingPlanError(
            "REASON_REQUIRED", "Vui lòng nhập lý do xử lý kỳ chuyển tiếp"
        )
    by_id = {fee.id: fee for fee in fees}
    if len(by_id) != len(fees) or len(set(replacement_fee_ids)) != len(
        replacement_fee_ids
    ):
        raise BillingPlanError("DUPLICATE_FEE", "Danh sách khoản thu bị trùng")
    replacement_ids = set(replacement_fee_ids)
    for fee_id in replacement_ids:
        fee = by_id.get(fee_id)
        if fee is None or not fee.active:
            raise BillingPlanError(
                "FEE_CHANGED", "Khoản thu đã thay đổi; vui lòng xem lại"
            )
        if fee.is_paid or fee.protected or fee.has_settlement or fee.status != "UNPAID":
            raise BillingPlanError(
                "PROTECTED_FEE",
                "Không thể thay thế khoản đã thanh toán hoặc có giao dịch tiền",
            )
        if fee.coverage is None:
            raise BillingPlanError(
                "UNKNOWN_COVERAGE", "Cần kiểm tra phạm vi kỳ thu cũ trước"
            )
        if fee.coverage.end <= transition_from:
            raise BillingPlanError(
                "OUT_OF_SCOPE_DEBT", "Không thể bỏ khoản nợ ngoài phạm vi điều chỉnh"
            )
    if len(set(historical_cycles)) != len(historical_cycles) or any(
        c < 0 or c >= first_cycle for c in historical_cycles
    ):
        raise BillingPlanError(
            "INVALID_HISTORICAL_CYCLES", "Danh sách kỳ truy thu không hợp lệ"
        )

    first_span = Interval(
        *cycle_coverage_interval(anchor, billing_type, cycle_weeks, first_cycle)
    )
    if any(
        f.status == "VOID" and (f.coverage is None or f.coverage.end > first_span.start)
        for f in fees
    ) or any(span.end > first_span.start for span in excluded_intervals):
        raise BillingPlanError(
            "WAIVED_CYCLE_OVERLAP",
            "Lịch mới đi qua kỳ đã huỷ; cần kiểm tra quyết định cũ trước",
        )
    if transition_from > first_span.start:
        raise BillingPlanError(
            "INVALID_TRANSITION", "Mốc áp dụng phải không sau kỳ thu đầu tiên"
        )
    kept = tuple(f for f in fees if f.active and f.id not in replacement_ids)
    for fee in kept:
        if fee.coverage is None:
            raise BillingPlanError(
                "UNKNOWN_COVERAGE", "Cần kiểm tra phạm vi kỳ thu cũ trước"
            )
        if fee.coverage.end > first_span.start:
            raise BillingPlanError(
                "FUTURE_FEE_OVERLAP",
                "Lịch mới giao với khoản được giữ lại; hãy chọn ranh giới khác",
            )

    charges: list[PlannedCharge] = []
    # Include any full cycles from the old schedule before the transition cutover
    for old_charge in old_schedule_charges:
        if any(
            f.coverage is not None and f.coverage.overlaps(old_charge.coverage)
            for f in (*kept, *(f for f in fees if f.status == "VOID"))
        ):
            raise BillingPlanError(
                "DUPLICATE_COVERAGE", "Kỳ được chọn đã có khoản học phí"
            )
        charges.append(old_charge)

    for cycle in sorted((*historical_cycles, first_cycle)):
        span = Interval(
            *cycle_coverage_interval(anchor, billing_type, cycle_weeks, cycle)
        )
        if any(
            f.coverage is not None and f.coverage.overlaps(span)
            for f in (*kept, *(f for f in fees if f.status == "VOID"))
        ) or any(excluded.overlaps(span) for excluded in excluded_intervals):
            raise BillingPlanError(
                "DUPLICATE_COVERAGE", "Kỳ được chọn đã có khoản học phí"
            )
        charges.append(
            PlannedCharge(
                coverage=span,
                due_date=span.start,
                amount=amount,
                cycle_no=cycle,
                kind="CYCLE",
                anchor_date=anchor,
                billing_type=billing_type,
                cycle_weeks=cycle_weeks,
            )
        )

    # Include any old portion removed by a replacement, even before the new
    # anchor. It must be billed or explicitly waived, never silently discarded.
    start = min([transition_from, *(by_id[i].coverage.start for i in replacement_ids)])
    scopes = [Interval(start, first_span.start)] if start < first_span.start else []
    covered = (
        tuple(f.coverage for f in kept if f.coverage is not None)
        + tuple(c.coverage for c in charges)
        + tuple(segment.coverage for segment in scheduled_segments)
        + excluded_intervals
        + tuple(
            f.coverage for f in fees if f.status == "VOID" and f.coverage is not None
        )
    )
    gaps = tuple(gap for scope in scopes for gap in uncovered_intervals(scope, covered))
    # A replaced future projection is replaced by the new recurring schedule;
    # it is not a historical waiver and is not immediately invoiced again.
    waived = gaps if gap_policy == "WAIVE" else ()
    if gap_policy == "CHARGE":
        trans_anchor = transition_anchor or anchor
        trans_type = transition_billing_type or billing_type
        trans_weeks = (
            transition_cycle_weeks
            if transition_cycle_weeks is not None
            else cycle_weeks
        )
        for gap in gaps:
            if custom_transition_amount is not None:
                bridge_amount = max(0, int(custom_transition_amount))
            else:
                bridge_amount = price_transition(
                    gap, trans_anchor, trans_type, trans_weeks, amount
                )
            charges.append(
                PlannedCharge(
                    coverage=gap,
                    due_date=first_span.start,
                    amount=bridge_amount,
                    cycle_no=None,
                    kind="TRANSITION",
                    anchor_date=trans_anchor,
                    billing_type=trans_type,
                    cycle_weeks=trans_weeks,
                )
            )
    return BillingChangePlan(
        enrollment_id=enrollment_id,
        version=version,
        business_date=business_date,
        anchor=anchor,
        billing_type=billing_type,
        cycle_weeks=cycle_weeks,
        first_cycle=first_cycle,
        keep_ids=tuple(sorted(f.id for f in kept)),
        supersede_ids=tuple(sorted(replacement_ids)),
        charges=tuple(sorted(charges, key=lambda c: (c.coverage.start, c.kind))),
        waived_intervals=waived,
        gap_intervals=gaps if gap_policy == "REVIEW" else (),
        source_digest=_digest([asdict(f) for f in sorted(fees, key=lambda f: f.id)]),
        reason=reason,
        scheduled_segments=scheduled_segments,
        retained_waived_intervals=excluded_intervals,
    )
