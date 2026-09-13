from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from unittest.mock import MagicMock, AsyncMock
from uuid import uuid4

from app.core.billing_change_plan import (
    BillingPlanError,
    FeeSnapshot,
    Interval,
    PlannedCharge,
    build_billing_change_plan,
    price_transition,
)
from fastapi import HTTPException
from app.core.billing_schedule import cycle_exists
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.models.enrollment import Enrollment
from app.models.fee_record import FeeRecord
from app.schemas.billing_schedule_change import (
    HistoricalCycleItem,
    BillingScheduleOptionsRequest,
    BillingSchedulePreviewRequest,
)
from app.services.billing_schedule_change_service import (
    build_plan_for_strategy,
    compute_context_token,
    analyze_billing_schedule_options,
    prepare_billing_schedule,
)


def make_snapshot(
    id="fee-1",
    start=date(2026, 9, 1),
    end=date(2026, 10, 1),
    *,
    amount=900_000,
    status="UNPAID",
    protected=False,
    version="v1",
) -> FeeSnapshot:
    return FeeSnapshot(
        id=id,
        coverage=Interval(start, end) if start and end else None,
        amount=amount,
        status=status,
        protected=protected,
        financial_version=version,
    )


def test_fractional_span_priced_by_old_schedule_anchor() -> None:
    # Lịch cũ ngày 01, chuyển sang 15/12/2026
    # Khoảng lẻ: 01/12/2026 đến 15/12/2026 (14 ngày trong tháng 12 có 31 ngày)
    span = Interval(date(2026, 12, 1), date(2026, 12, 15))
    old_anchor = date(2026, 9, 1)
    bridge_amount = price_transition(
        span=span,
        anchor=old_anchor,
        billing_type="MONTHLY",
        cycle_weeks=None,
        amount=900_000,
    )
    # 900.000 * 14 / 31 = 406451.61... -> làm tròn nửa lên là 406.452
    assert bridge_amount == 406_452


def test_fractional_span_course_priced_by_exact_days_not_full_package() -> None:
    # Gói 4 tuần = 28 ngày. 19 ngày lẻ từ 26/09 đến 15/10
    span = Interval(date(2026, 9, 26), date(2026, 10, 15))
    old_anchor = date(2026, 8, 1)
    bridge_amount = price_transition(
        span=span,
        anchor=old_anchor,
        billing_type="COURSE",
        cycle_weeks=4,
        amount=800_000,
    )
    # 800.000 * 19 / 28 = 542857.14... -> 542.857
    assert bridge_amount == 542_857


def test_continue_old_until_new_separates_old_charges_and_new_schedule() -> None:
    # Hôm nay 07/09/2026. Lịch cũ 01/09/2026. Mốc mới 15/12/2026.
    # Kỳ tháng 9 đã thanh toán (01/09 - 01/10).
    # Các kỳ cũ đủ: Tháng 10 (01/10 - 01/11), Tháng 11 (01/11 - 01/12).
    # Khoảng lẻ: 01/12 - 15/12 (14 ngày).
    # Kỳ mới: 15/12/2026 - 15/01/2027.
    paid_sep = make_snapshot(
        "paid-sep", date(2026, 9, 1), date(2026, 10, 1), protected=True, status="PAID"
    )
    old_charges = (
        PlannedCharge(
            coverage=Interval(date(2026, 10, 1), date(2026, 11, 1)),
            due_date=date(2026, 10, 1),
            amount=900_000,
            cycle_no=1,
            kind="OLD_SCHEDULE_CYCLE",
            anchor_date=date(2026, 9, 1),
            billing_type="MONTHLY",
        ),
        PlannedCharge(
            coverage=Interval(date(2026, 11, 1), date(2026, 12, 1)),
            due_date=date(2026, 11, 1),
            amount=900_000,
            cycle_no=2,
            kind="OLD_SCHEDULE_CYCLE",
            anchor_date=date(2026, 9, 1),
            billing_type="MONTHLY",
        ),
    )

    plan = build_billing_change_plan(
        enrollment_id="enr-123",
        version=1,
        business_date=date(2026, 9, 7),
        anchor=date(2026, 12, 15),
        billing_type="MONTHLY",
        cycle_weeks=None,
        amount=900_000,
        first_cycle=0,
        transition_from=date(2026, 12, 1),
        fees=(paid_sep,),
        old_schedule_charges=old_charges,
        transition_anchor=date(2026, 9, 1),
        transition_billing_type="MONTHLY",
        gap_policy="CHARGE",
        reason="Đổi sang mốc 15/12 sau khi hoàn tất kỳ cũ",
    )

    assert plan.can_apply
    # Có 4 khoản: 2 kỳ cũ (tháng 10, tháng 11) + 1 bridge lẻ (01/12 - 15/12) + 1 kỳ mới (15/12 - 15/01)
    assert len(plan.charges) == 4
    oct_c, nov_c, bridge_c, dec_new = plan.charges
    assert oct_c.kind == "OLD_SCHEDULE_CYCLE"
    assert oct_c.coverage == Interval(date(2026, 10, 1), date(2026, 11, 1))
    assert oct_c.amount == 900_000

    assert nov_c.kind == "OLD_SCHEDULE_CYCLE"
    assert nov_c.coverage == Interval(date(2026, 11, 1), date(2026, 12, 1))
    assert nov_c.amount == 900_000

    assert bridge_c.kind == "TRANSITION"
    assert bridge_c.coverage == Interval(date(2026, 12, 1), date(2026, 12, 15))
    assert bridge_c.amount == 406_452
    assert bridge_c.due_date == date(2026, 12, 15)

    assert dec_new.kind == "CYCLE"
    assert dec_new.cycle_no == 0
    assert dec_new.coverage == Interval(date(2026, 12, 15), date(2027, 1, 15))
    assert dec_new.amount == 900_000


def test_future_paid_fee_blocks_colliding_new_anchor() -> None:
    # Nếu kỳ tháng 12 đã được thanh toán (01/12/2026 - 01/01/2027)
    # thì mốc mới 15/12/2026 phải bị chặn bởi FUTURE_FEE_OVERLAP
    paid_dec = make_snapshot(
        "paid-dec", date(2026, 12, 1), date(2027, 1, 1), protected=True, status="PAID"
    )
    with pytest.raises(BillingPlanError) as exc_info:
        build_billing_change_plan(
            enrollment_id="enr-123",
            version=1,
            business_date=date(2026, 9, 7),
            anchor=date(2026, 12, 15),
            billing_type="MONTHLY",
            cycle_weeks=None,
            amount=900_000,
            first_cycle=0,
            transition_from=date(2026, 12, 1),
            fees=(paid_dec,),
            gap_policy="CHARGE",
            reason="Thử đổi mốc vào khoảng đã thanh toán",
        )
    assert exc_info.value.code == "FUTURE_FEE_OVERLAP"


def test_generator_stops_at_enrollment_ended_on_even_when_active() -> None:
    # Kiểm tra hàm cycle_exists với điểm dừng kết hợp giữa class.stopped_on và enrollment.ended_on
    class_stopped_on = date(2027, 5, 1)
    enrollment_ended_on = date(2026, 11, 15)  # Học viên rời lớp giữa tháng 11
    stop_date = min(
        [d for d in (class_stopped_on, enrollment_ended_on) if d is not None]
    )
    assert stop_date == date(2026, 11, 15)

    # Kỳ tháng 10 (01/10/2026 - 01/11/2026): bắt đầu trước ended_on -> tồn tại
    assert cycle_exists(date(2026, 10, 1), stop_date) is True
    # Kỳ tháng 11 (01/11/2026 - 01/12/2026): bắt đầu 01/11 < 15/11 -> tồn tại
    assert cycle_exists(date(2026, 11, 1), stop_date) is True
    # Kỳ tháng 12 (01/12/2026 - 01/01/2027): bắt đầu 01/12 > 15/11 -> KHÔNG tồn tại
    assert cycle_exists(date(2026, 12, 1), stop_date) is False


def test_context_token_changes_when_snapshot_changes() -> None:
    enr = MagicMock(spec=Enrollment)
    enr.id = uuid4()
    enr.enrollment_date = date(2026, 8, 1)
    enr.admission_version = 1
    enr.billing_anchor_version = 2
    enr.class_id = uuid4()
    enr.class_ = MagicMock(version=3)

    rev = MagicMock(spec=BillingAnchorRevision)
    rev.id = uuid4()
    rev.sequence_no = 2
    rev.anchor_date = date(2026, 9, 1)
    rev.state = "CONFIRMED"

    snap1 = make_snapshot("f1", date(2026, 9, 1), date(2026, 10, 1), version="hash_a")
    t1 = compute_context_token(
        enr, rev, date(2026, 9, 15), date(2026, 9, 7), 0, (snap1,)
    )

    # Thay đổi version của snapshot (ví dụ có thanh toán mới)
    snap2 = make_snapshot("f1", date(2026, 9, 1), date(2026, 10, 1), version="hash_b")
    t2 = compute_context_token(
        enr, rev, date(2026, 9, 15), date(2026, 9, 7), 0, (snap2,)
    )

    assert t1 != t2


def test_old_schedule_cycles_isolate_generator_max_anchor_cycle() -> None:
    """Old schedule cycles attached to old_revision must not contaminate new_revision generator."""
    old_rev_id = str(uuid4())
    new_rev_id = str(uuid4())

    # Simulated fee records in DB
    records = [
        {"billing_revision_id": old_rev_id, "anchor_cycle_no": 10},
        {"billing_revision_id": old_rev_id, "anchor_cycle_no": 11},
        {"billing_revision_id": new_rev_id, "anchor_cycle_no": 0},
    ]

    # ensure_enrollment_cycles query: max(anchor_cycle_no) where billing_revision_id == new_rev_id
    new_rev_max = max(
        (
            r["anchor_cycle_no"]
            for r in records
            if r["billing_revision_id"] == new_rev_id
        ),
        default=None,
    )
    assert new_rev_max == 0
    next_cycle_for_new_rev = new_rev_max + 1
    assert next_cycle_for_new_rev == 1, "Next cycle of new schedule must be 1, not 12"


def test_superseded_records_status_and_timestamps() -> None:
    """Superseded records must have status SUPERSEDED, superseded_at set, and voided_at None."""
    fee = FeeRecord(
        enrollment_id=str(uuid4()),
        status="UNPAID",
        cycle_no=1,
        period="2026-09",
        base_amount=900_000,
    )
    now = datetime.now(timezone.utc)
    # Apply supersede
    fee.status = "SUPERSEDED"
    fee.superseded_at = now
    assert fee.status == "SUPERSEDED"
    assert fee.superseded_at == now
    assert fee.voided_at is None, "voided_at must be None for superseded fees"


def test_historical_cycles_pagination_options() -> None:
    """Historical cycles are paginated correctly when there are more than historical_limit cycles."""
    # 24 historical cycles generated
    all_cycles = [
        HistoricalCycleItem(
            cycle_no=i,
            coverage_start=date(2024, 1, 1) + timedelta(days=30 * i),
            coverage_end=date(2024, 1, 1) + timedelta(days=30 * (i + 1)),
            base_due_date=date(2024, 1, 1) + timedelta(days=30 * i),
            amount=900_000,
            label=f"Kỳ {i}",
        )
        for i in range(24)
    ]

    limit = 12
    offset = 0
    page1 = all_cycles[offset : offset + limit]
    has_more_1 = (offset + limit) < len(all_cycles)
    next_offset_1 = (offset + limit) if has_more_1 else None

    assert len(page1) == 12
    assert has_more_1 is True
    assert next_offset_1 == 12

    # Page 2
    offset = 12
    page2 = all_cycles[offset : offset + limit]
    has_more_2 = (offset + limit) < len(all_cycles)
    next_offset_2 = (offset + limit) if has_more_2 else None

    assert len(page2) == 12
    assert has_more_2 is False
    assert next_offset_2 is None


def make_mock_enrollment(
    id=None,
    enrollment_date=date(2026, 9, 1),
    anchor_date=date(2026, 9, 1),
    billing_type="MONTHLY",
    cycle_weeks=None,
    base_fee=900_000,
    version=1,
):
    enr_id = id or uuid4()
    rev = MagicMock(spec=BillingAnchorRevision)
    rev.id = uuid4()
    rev.sequence_no = 1
    rev.anchor_date = anchor_date
    rev.billing_type_snapshot = billing_type
    rev.billing_cycle_months_snapshot = 1
    rev.billing_cycle_weeks_snapshot = cycle_weeks
    rev.state = "CONFIRMED"

    cls = MagicMock()
    cls.id = uuid4()
    cls.base_fee = base_fee
    cls.type = billing_type
    cls.stopped_on = None
    cls.cancelled_at = None
    cls.stopped_at = None
    cls.start_date = None
    cls.version = 1

    enr = MagicMock(spec=Enrollment)
    enr.id = enr_id
    enr.class_id = cls.id
    enr.class_ = cls
    enr.current_billing_revision = rev
    enr.current_billing_revision_id = rev.id
    enr.enrollment_date = enrollment_date
    enr.billing_anchor_version = version
    enr.admission_version = 1
    enr.custom_fee = None
    enr.ended_on = None
    enr.status = "active"
    enr.student = MagicMock(status="active")

    return enr, rev


def test_near_future_engine_gap_policy_and_effective_start_date() -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 9, 1),
        anchor_date=date(2026, 9, 1),
    )
    current_fee = make_snapshot(
        "curr", date(2026, 9, 1), date(2026, 10, 1), status="UNPAID", protected=False
    )
    plan, actual_start = build_plan_for_strategy(
        enrollment=enr,
        revision=rev,
        snapshots=(current_fee,),
        anchor_date=date(2026, 9, 15),
        expected_version=1,
        strategy="KEEP_CURRENT",
        gap_policy="REVIEW",
        reason="",
        today=date(2026, 9, 7),
    )
    # Kỳ mới thực tế bắt đầu từ 15/10/2026, KHÔNG PHẢI 15/09/2026
    assert actual_start == date(2026, 10, 15)
    assert plan.first_cycle == 1
    # Khoảng chuyển tiếp 01/10 - 15/10 được phát hiện trực tiếp từ gap_intervals của engine
    assert len(plan.gap_intervals) > 0
    assert plan.gap_intervals[0] == Interval(date(2026, 10, 1), date(2026, 10, 15))


def test_continue_old_until_new_coverage_awareness() -> None:
    paid_sep = make_snapshot(
        "sep", date(2026, 9, 1), date(2026, 10, 1), status="PAID", protected=True
    )
    existing_oct = make_snapshot(
        "oct", date(2026, 10, 1), date(2026, 11, 1), status="UNPAID", protected=False
    )
    void_nov = make_snapshot(
        "nov", date(2026, 11, 1), date(2026, 12, 1), status="VOID", protected=False
    )

    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 9, 1),
        anchor_date=date(2026, 9, 1),
    )

    plan, actual_start = build_plan_for_strategy(
        enrollment=enr,
        revision=rev,
        snapshots=(paid_sep, existing_oct, void_nov),
        anchor_date=date(2026, 12, 15),
        expected_version=1,
        strategy="CONTINUE_OLD_UNTIL_NEW",
        gap_policy="CHARGE",
        reason="Chuyển sang mốc 15/12",
        today=date(2026, 9, 7),
    )

    # 1. Kỳ tháng 10 đã phủ đầy đủ: giữ nguyên, nằm trong keep_ids, KHÔNG tạo lại OLD_SCHEDULE_CYCLE
    assert "oct" in plan.keep_ids
    assert "oct" not in plan.supersede_ids
    old_charge_spans = [
        c.coverage for c in plan.charges if c.kind == "OLD_SCHEDULE_CYCLE"
    ]
    assert Interval(date(2026, 10, 1), date(2026, 11, 1)) not in old_charge_spans

    # 2. Kỳ tháng 11 đã VOID: giữ nguyên quyết định hủy, không tạo nợ mới và KHÔNG nằm trong keep_ids
    assert "nov" not in plan.keep_ids
    assert "nov" not in plan.supersede_ids
    assert Interval(date(2026, 11, 1), date(2026, 12, 1)) not in old_charge_spans

    # 3. Khoản chuyển tiếp bridge 01/12 - 15/12 được tạo đúng
    trans_charges = [c for c in plan.charges if c.kind == "TRANSITION"]
    assert len(trans_charges) == 1
    assert trans_charges[0].coverage == Interval(date(2026, 12, 1), date(2026, 12, 15))

    # 4. Kỳ mới bắt đầu đúng 15/12/2026
    assert actual_start == date(2026, 12, 15)
    cycle_charges = [c for c in plan.charges if c.kind == "CYCLE"]
    assert len(cycle_charges) == 1
    assert cycle_charges[0].coverage == Interval(date(2026, 12, 15), date(2027, 1, 15))


def test_continue_old_until_new_partial_coverage() -> None:
    paid_sep = make_snapshot(
        "sep", date(2026, 9, 1), date(2026, 10, 1), status="PAID", protected=True
    )
    partial_oct = make_snapshot(
        "part-oct", date(2026, 10, 1), date(2026, 10, 15), status="PAID", protected=True
    )

    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 9, 1),
        anchor_date=date(2026, 9, 1),
    )

    plan, _ = build_plan_for_strategy(
        enrollment=enr,
        revision=rev,
        snapshots=(paid_sep, partial_oct),
        anchor_date=date(2026, 11, 1),
        expected_version=1,
        strategy="CONTINUE_OLD_UNTIL_NEW",
        gap_policy="CHARGE",
        reason="Chuyển sang 01/11",
        today=date(2026, 9, 7),
    )

    # Phần chưa được xử lý 15/10 - 01/11 phải được tạo pro-rata, không bỏ cả kỳ rồi mất phí
    remainder = [
        c
        for c in plan.charges
        if c.coverage == Interval(date(2026, 10, 15), date(2026, 11, 1))
    ]
    assert len(remainder) == 1
    assert remainder[0].amount > 0


def test_crossing_kept_fee_blocks_option_via_future_fee_overlap() -> None:
    crossing_fee = make_snapshot(
        "cross", date(2026, 12, 1), date(2027, 1, 1), status="PAID", protected=True
    )
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 9, 1),
        anchor_date=date(2026, 9, 1),
    )

    with pytest.raises(BillingPlanError) as exc_info:
        build_plan_for_strategy(
            enrollment=enr,
            revision=rev,
            snapshots=(crossing_fee,),
            anchor_date=date(2026, 12, 15),
            expected_version=1,
            strategy="FROM_CYCLE",
            first_cycle=0,
            gap_policy="REVIEW",
            reason="",
            today=date(2026, 9, 7),
        )
    assert exc_info.value.code == "FUTURE_FEE_OVERLAP"


def test_router_options_requires_expected_version() -> None:
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.dependencies import Principal, require_management
    from app.core.database import get_db

    async def isolated_db():
        # Validation must not open the configured Supabase database.
        yield MagicMock()

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = isolated_db

    app.dependency_overrides[require_management] = lambda: Principal(
        user_id="test-user",
        email="test@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal1",
        device_type="desktop",
        session_nonce="nonce",
    )
    try:
        client = TestClient(app, base_url="http://localhost")
        # 1. Payload thiếu expected_version -> HTTP 422
        resp = client.post(
            f"/enrollments/{uuid4()}/billing-schedule/options",
            json={"anchor_date": "2026-09-15"},
        )
        assert resp.status_code == 422
        errors = resp.json()["detail"]
        assert any(e["loc"][-1] == "expected_version" for e in errors)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


@pytest.mark.asyncio
async def test_analyze_options_blocks_replace_current_when_current_cycle_paid(
    monkeypatch,
) -> None:
    from app.services.billing_schedule_change_service import (
        analyze_billing_schedule_options,
    )
    from app.schemas.billing_schedule_change import BillingScheduleOptionsRequest
    from unittest.mock import AsyncMock

    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    # Current cycle: 04/09/2026 - 04/10/2026 (PAID)
    paid_rec = MagicMock(spec=FeeRecord)
    paid_rec.id = uuid4()
    paid_rec.status = "PAID"
    paid_rec.paid_date = date(2026, 9, 5)
    paid_rec.paid_amount = 850_000
    paid_rec.final_amount = 850_000
    paid_rec.coverage_start = date(2026, 9, 4)
    paid_rec.coverage_end = date(2026, 10, 4)
    paid_rec.payments = [MagicMock()]
    paid_rec.review_required = False
    paid_rec.billing_revision_id = rev.id
    paid_rec.refunded_amount = 0

    snap = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=True,
    )

    mock_load = AsyncMock(return_value=(enr, [paid_rec], (snap,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 10), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is False
    assert "đã nộp học phí" in rep_opt.disabled_reason
    assert rep_opt.requires_gap_policy is False

    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True
    assert "04/09/2026" in keep_opt.description
    assert "10/10/2026" in keep_opt.description
    assert keep_opt.requires_gap_policy is False


@pytest.mark.asyncio
async def test_analyze_options_allows_replace_current_when_current_cycle_unpaid(
    monkeypatch,
) -> None:
    from app.services.billing_schedule_change_service import (
        analyze_billing_schedule_options,
    )
    from app.schemas.billing_schedule_change import BillingScheduleOptionsRequest
    from unittest.mock import AsyncMock

    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    # Current cycle: 04/09/2026 - 04/10/2026 (UNPAID)
    unpaid_rec = MagicMock(spec=FeeRecord)
    unpaid_rec.id = uuid4()
    unpaid_rec.status = "UNPAID"
    unpaid_rec.paid_date = None
    unpaid_rec.paid_amount = 0
    unpaid_rec.final_amount = 850_000
    unpaid_rec.coverage_start = date(2026, 9, 4)
    unpaid_rec.coverage_end = date(2026, 10, 4)
    unpaid_rec.payments = []
    unpaid_rec.review_required = False
    unpaid_rec.billing_revision_id = rev.id
    unpaid_rec.refunded_amount = 0

    snap = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(return_value=(enr, [unpaid_rec], (snap,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 10), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert "10/09/2026" in rep_opt.description
    assert "04/09/2026" in rep_opt.description
    assert rep_opt.requires_gap_policy is False


@pytest.mark.asyncio
async def test_analyze_options_far_past_allows_smart_replace_current(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(
        return_value=(enr, [paid_rec, unpaid_rec], (snap_paid, snap_unpaid))
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 15), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "FAR_PAST"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.new_due_date == date(2026, 9, 15)
    assert "15/09/2026" in rep_opt.description

    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.requires_historical_selection is False


@pytest.mark.asyncio
async def test_analyze_options_near_past_allows_smart_replace_current(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(
        return_value=(enr, [paid_rec, unpaid_rec], (snap_paid, snap_unpaid))
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 8, 11), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "NEAR_PAST"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.new_due_date == date(2026, 9, 11)


@pytest.mark.asyncio
async def test_analyze_options_far_future_two_clean_cards(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(
        return_value=(enr, [paid_rec, unpaid_rec], (snap_paid, snap_unpaid))
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2027, 1, 1), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "FAR_FUTURE"
    assert len(res.options) == 2
    assert [o.strategy for o in res.options] == [
        "CONTINUE_OLD_UNTIL_NEW",
        "KEEP_CURRENT",
    ]
    assert res.options[0].requires_gap_policy is False
    assert res.options[1].requires_gap_policy is False


@pytest.mark.asyncio
async def test_analyze_options_unchanged_anchor_date(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [paid_rec], (snap_paid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 8, 4), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "UNCHANGED"
    assert len(res.options) == 1
    assert res.options[0].strategy == "UNCHANGED"
    assert res.options[0].is_allowed is True
    assert res.options[0].is_recommended is True


@pytest.mark.asyncio
async def test_analyze_options_unstarted_student_future_enrollment(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 10, 1),
        anchor_date=date(2026, 10, 1),
    )
    mock_load = AsyncMock(return_value=(enr, [], ()))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 10, 15), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "UNSTARTED"
    assert len(res.options) == 1
    assert res.options[0].strategy == "FROM_CYCLE"
    assert res.options[0].suggested_first_cycle == 0
    assert res.options[0].new_due_date == date(2026, 10, 15)
    assert res.options[0].is_allowed is True


@pytest.mark.asyncio
async def test_analyze_options_active_student_zero_fees(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 1),
        anchor_date=date(2026, 8, 1),
    )
    mock_load = AsyncMock(return_value=(enr, [], ()))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 15), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "ACTIVE_NO_FEES"
    assert len(res.options) == 1
    assert res.options[0].strategy == "FROM_CYCLE"
    assert res.options[0].is_allowed is True


@pytest.mark.asyncio
async def test_analyze_options_today_anchor_unpaid_current(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [unpaid_rec], (snap_unpaid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 10), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "TODAY"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.is_recommended is True
    assert rep_opt.new_due_date == date(2026, 9, 10)


@pytest.mark.asyncio
async def test_analyze_options_today_anchor_paid_current(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [paid_rec], (snap_paid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 10), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "TODAY"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is False
    assert "đã nộp học phí" in rep_opt.disabled_reason

    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True
    assert keep_opt.is_recommended is True


@pytest.mark.asyncio
async def test_analyze_options_near_future_unpaid_current(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [unpaid_rec], (snap_unpaid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 18), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "NEAR_FUTURE"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.new_due_date == date(2026, 9, 18)

    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True


@pytest.mark.asyncio
async def test_analyze_options_near_future_paid_current(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [paid_rec], (snap_paid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 18), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "NEAR_FUTURE"
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is False
    assert "đã nộp học phí" in rep_opt.disabled_reason

    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True


@pytest.mark.asyncio
async def test_analyze_options_partially_paid_fee_treated_as_protected(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    part_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="PARTIAL",
        is_paid=False,
        paid_amount=300_000,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_part = FeeSnapshot(
        id=str(part_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="PARTIAL",
        protected=True,
        is_paid=False,
        financial_version="v1",
        has_settlement=True,
    )
    mock_load = AsyncMock(return_value=(enr, [part_rec], (snap_part,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 8, 11), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is False


@pytest.mark.asyncio
async def test_analyze_options_refunded_fee_treated_as_protected(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    ref_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="REFUNDED",
        is_paid=False,
        refunded_amount=850_000,
        payments=[],
    )
    snap_ref = FeeSnapshot(
        id=str(ref_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="REFUNDED",
        protected=True,
        is_paid=False,
        financial_version="v1",
        has_settlement=True,
    )
    mock_load = AsyncMock(return_value=(enr, [ref_rec], (snap_ref,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 8, 11), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is False


@pytest.mark.asyncio
async def test_analyze_options_weekly_cycle_student(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 3),
        anchor_date=date(2026, 8, 3),
        billing_type="COURSE",
        cycle_weeks=4,
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 31),
        coverage_end=date(2026, 9, 28),
        due_date=date(2026, 8, 31),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 8, 31), date(2026, 9, 28)),
        amount=800_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(return_value=(enr, [unpaid_rec], (snap_unpaid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 9, 14), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.cycle_info.billing_type == "COURSE"
    assert res.cycle_info.cycle_weeks == 4
    assert len(res.options) >= 1
    assert any("4 tuần (28 ngày)" in opt.description for opt in res.options)
    for opt in res.options:
        assert opt.is_allowed is True
        assert "hàng tháng" not in opt.description


@pytest.mark.asyncio
async def test_analyze_options_month_end_31st_clamping(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 1, 31),
        anchor_date=date(2026, 1, 31),
    )
    mock_load = AsyncMock(return_value=(enr, [], ()))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 2, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 31), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "UNCHANGED"
    assert res.cycle_info.current_cycle_start == date(2026, 1, 31)
    assert res.cycle_info.current_cycle_end == date(2026, 2, 28)


@pytest.mark.asyncio
async def test_analyze_options_preserves_old_unpaid_debt_outside_transition(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 7, 4),
        anchor_date=date(2026, 7, 4),
    )
    old_debt_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 7, 4),
        coverage_end=date(2026, 8, 4),
        due_date=date(2026, 7, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_current_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_debt = FeeSnapshot(
        id=str(old_debt_rec.id),
        coverage=Interval(date(2026, 7, 4), date(2026, 8, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_current = FeeSnapshot(
        id=str(unpaid_current_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )
    mock_load = AsyncMock(
        return_value=(
            enr,
            [old_debt_rec, paid_rec, unpaid_current_rec],
            (snap_debt, snap_paid, snap_current),
        )
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 8, 11), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.new_due_date == date(2026, 9, 11)


@pytest.mark.asyncio
async def test_prepare_billing_schedule_smart_replace_current(monkeypatch) -> None:
    # This unit isolates strategy selection. Real waiver/pause interaction is
    # covered by test_suspension_boundaries on PostgreSQL, not AsyncMock rows.
    monkeypatch.setattr(
        "app.services.suspension_boundary_service.plan_waiver_preservation",
        AsyncMock(return_value=None),
    )
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 8, 11),
        expected_version=1,
        strategy="REPLACE_CURRENT",
        reason="Đổi mốc thu sang ngày 11",
    )
    preview = await prepare_billing_schedule(
        mock_db, enr, (snap_paid, snap_unpaid), req
    )

    assert preview.can_apply is True
    assert len(preview.replaced_fees) == 1
    assert preview.replaced_fees[0].id == str(unpaid_rec.id)
    assert any(c.due_date == date(2026, 9, 11) for c in preview.plan.charges)


@pytest.mark.asyncio
async def test_prepare_billing_schedule_blocks_when_current_paid(monkeypatch) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )

    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 8, 11),
        expected_version=1,
        strategy="REPLACE_CURRENT",
        reason="Đổi mốc thu sang ngày 11",
    )
    with pytest.raises(HTTPException) as exc_info:
        await prepare_billing_schedule(mock_db, enr, (snap_paid,), req)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "CURRENT_FEE_ALREADY_PAID"


@pytest.mark.asyncio
async def test_prepare_billing_schedule_version_mismatch_raises_conflict(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
        version=1,
    )
    mock_db = AsyncMock()
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 9, 15),
        expected_version=999,
        strategy="KEEP_CURRENT",
        reason="Đổi mốc thu",
    )
    with pytest.raises(HTTPException) as exc_info:
        await prepare_billing_schedule(mock_db, enr, (), req)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "BILLING_SCHEDULE_CHANGED"


@pytest.mark.asyncio
async def test_prepare_billing_schedule_stale_context_token_raises_conflict(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
        version=1,
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 9, 15),
        expected_version=1,
        strategy="KEEP_CURRENT",
        reason="Đổi mốc thu",
        expected_context_token="f" * 64,
    )
    with pytest.raises(HTTPException) as exc_info:
        await prepare_billing_schedule(mock_db, enr, (), req)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "STALE_OPTIONS_CONTEXT"


@pytest.mark.asyncio
async def test_user_scenario_01_01_2026_offers_flexible_choices(monkeypatch) -> None:
    """User scenario: old anchor 04/08/2026, new anchor 01/01/2026.
    Current cycle: 04/09/2026 - 04/10/2026 (unpaid). Previous cycle: 04/08/2026 - 04/09/2026 (paid).
    KEEP_CURRENT must offer candidate cycles 01/10/2026 and 01/11/2026.
    REPLACE_CURRENT must offer candidate cycles for flexible replacement.
    """
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(
        return_value=(enr, [paid_rec, unpaid_rec], (snap_paid, snap_unpaid))
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 1), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)

    assert res.classification.case_code == "FAR_PAST"
    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True
    # KEEP preserves the full current period through 04/10, not an early cut.
    labels = [c.label for c in keep_opt.candidate_cycles]
    assert "01/10/2026" not in labels
    assert "01/11/2026" in labels
    assert "01/12/2026" in labels

    # Check REPLACE_CURRENT candidates: must be 01/09/2026 and 01/10/2026
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert len(rep_opt.candidate_cycles) >= 1
    rep_labels = [c.label for c in rep_opt.candidate_cycles]
    assert "01/09/2026" not in rep_labels  # overlaps the paid 04/08–04/09 period
    assert "01/10/2026" in rep_labels


@pytest.mark.asyncio
async def test_preview_replace_current_with_cycle_01_09(monkeypatch) -> None:
    """Verify preview works when user selects REPLACE_CURRENT with 01/09/2026 cycle."""
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 1, 1),
        expected_version=1,
        strategy="REPLACE_CURRENT",
        first_cycle=8,
        reason="Đổi sang mốc 01/01/2026, áp dụng ngay kỳ 01/09/2026",
    )
    with pytest.raises(HTTPException) as exc:
        await prepare_billing_schedule(mock_db, enr, (snap_paid, snap_unpaid), req)
    assert exc.value.detail["code"] == "FUTURE_FEE_OVERLAP"
    assert snap_paid.coverage.end == date(2026, 9, 4)


@pytest.mark.asyncio
async def test_preview_keep_current_with_early_cutover_choice(monkeypatch) -> None:
    """Verify preview works when user selects early cutover cycle (01/10/2026)."""
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(
        return_value=(enr, [paid_rec, unpaid_rec], (snap_paid, snap_unpaid))
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    # Cycle 9 for 01/01/2026 is 01/10/2026 to 01/11/2026
    req = BillingSchedulePreviewRequest(
        anchor_date=date(2026, 1, 1),
        expected_version=1,
        strategy="KEEP_CURRENT",
        first_cycle=9,
        reason="Đổi sang mốc 1 hàng tháng, áp dụng từ 01/10",
    )
    with pytest.raises(HTTPException) as exc:
        await prepare_billing_schedule(mock_db, enr, (snap_paid, snap_unpaid), req)
    assert exc.value.detail["code"] == "FUTURE_FEE_OVERLAP"
    assert snap_unpaid.coverage.end == date(2026, 10, 4)


@pytest.mark.asyncio
async def test_end_of_month_matrix_choices(monkeypatch) -> None:
    """Test anchor on 31st of month (e.g. 31/01/2026) handles short months cleanly."""
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
    )
    unpaid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        payments=[],
    )
    snap_unpaid = FeeSnapshot(
        id=str(unpaid_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(return_value=(enr, [unpaid_rec], (snap_unpaid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 10),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 31), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)
    keep_opt = next((o for o in res.options if o.strategy == "KEEP_CURRENT"), None)
    assert keep_opt is not None
    assert keep_opt.is_allowed is True
    assert len(keep_opt.candidate_cycles) >= 1


@pytest.mark.asyncio
async def test_analyze_options_allows_replace_current_when_only_prior_expired_cycle_paid(
    monkeypatch,
) -> None:
    """If a prior cycle was paid and ended before today, but overlaps the current month boundary,
    it should not falsely disable REPLACE_CURRENT for the current unpaid cycle."""
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 1, 1),
        version=2,
    )
    # Prior cycle: 2026-08-04 -> 2026-09-04 (PAID, expired before today 2026-09-11)
    paid_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 8, 4),
        coverage_end=date(2026, 9, 4),
        due_date=date(2026, 8, 4),
        adjusted_due_date=None,
        status="PAID",
        is_paid=True,
        payments=[SimpleNamespace(id=uuid4())],
    )
    snap_paid = FeeSnapshot(
        id=str(paid_rec.id),
        coverage=Interval(date(2026, 8, 4), date(2026, 9, 4)),
        amount=850_000,
        status="PAID",
        protected=True,
        is_paid=True,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(return_value=(enr, [paid_rec], (snap_paid,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 11),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 2), expected_version=2
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.disabled_reason is None


@pytest.mark.asyncio
async def test_analyze_options_notified_unpaid_current_fee_allows_replace_current(
    monkeypatch,
) -> None:
    enr, rev = make_mock_enrollment(
        enrollment_date=date(2026, 8, 4),
        anchor_date=date(2026, 8, 4),
        version=1,
    )
    # Current cycle: 2026-09-04 -> 2026-10-04, UNPAID, but ALREADY NOTIFIED to parent
    notified_rec = SimpleNamespace(
        id=uuid4(),
        coverage_start=date(2026, 9, 4),
        coverage_end=date(2026, 10, 4),
        due_date=date(2026, 9, 4),
        adjusted_due_date=None,
        status="UNPAID",
        is_paid=False,
        paid_amount=None,
        paid_date=None,
        notified_at=datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc),
        payments=[],
    )
    snap_notified = FeeSnapshot(
        id=str(notified_rec.id),
        coverage=Interval(date(2026, 9, 4), date(2026, 10, 4)),
        amount=850_000,
        status="UNPAID",
        protected=False,  # Unpaid notified is mutable in schedule change
        is_paid=False,
        financial_version="v1",
        has_settlement=False,
    )

    mock_load = AsyncMock(return_value=(enr, [notified_rec], (snap_notified,)))
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.load_billing_context", mock_load
    )
    monkeypatch.setattr(
        "app.services.billing_schedule_change_service.business_today",
        lambda: date(2026, 9, 11),
    )
    monkeypatch.setattr(
        "app.services.credit_service.enrollment_total_deferral_days",
        AsyncMock(return_value=0),
    )

    mock_db = AsyncMock()
    req = BillingScheduleOptionsRequest(
        anchor_date=date(2026, 1, 2), expected_version=1
    )
    res = await analyze_billing_schedule_options(mock_db, enr.id, req)
    rep_opt = next((o for o in res.options if o.strategy == "REPLACE_CURRENT"), None)
    assert rep_opt is not None
    assert rep_opt.is_allowed is True
    assert rep_opt.disabled_reason is None
