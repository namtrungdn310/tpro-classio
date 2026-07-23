from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import app.services.dashboard_service as dashboard_service

from app.core.business_time import business_today
from app.core.dependencies import get_current_user, require_admin
from app.routers.dashboard import router as dashboard_router
from app.services.dashboard_service import _period_key


def test_dashboard_uses_vietnam_business_date() -> None:
    utc_time = datetime(2026, 7, 31, 18, 30, tzinfo=timezone.utc)

    assert business_today(utc_time).isoformat() == "2026-08-01"
    assert _period_key(business_today(utc_time)) == "2026-08"


def test_dashboard_fee_summary_is_available_to_every_authenticated_role() -> None:
    overview_route = next(
        route for route in dashboard_router.routes if route.path == "/overview"
    )
    dependency_calls = {
        dependency.call for dependency in overview_route.dependant.dependencies
    }

    assert get_current_user in dependency_calls
    assert require_admin not in dependency_calls


class _DashboardResult:
    def one(self) -> SimpleNamespace:
        return SimpleNamespace(
            active_student_count=32,
            active_class_count=12,
            weekly_session_count=26,
            active_teacher_count=4,
            active_assistant_count=2,
            total_amount=Decimal("32000000"),
            gross_collected_amount=Decimal("24000000"),
            refunded_amount=Decimal("1000000"),
            net_collected_amount=Decimal("23000000"),
            outstanding_amount=Decimal("8000000"),
            paid_record_count=24,
            record_count=32,
            revenue_trend=[
                {"period": "2026-02", "net_collected_amount": 19_000_000},
                {"period": "2026-03", "net_collected_amount": 21_000_000},
                {"period": "2026-04", "net_collected_amount": 20_500_000},
                {"period": "2026-05", "net_collected_amount": 23_000_000},
                {"period": "2026-06", "net_collected_amount": 22_000_000},
                {"period": "2026-07", "net_collected_amount": 23_000_000},
            ],
        )


class _DashboardSession:
    def __init__(self) -> None:
        self.parameters: dict[str, object] | None = None

    async def execute(
        self,
        _statement: object,
        parameters: dict[str, object],
    ) -> _DashboardResult:
        self.parameters = parameters
        return _DashboardResult()


async def test_dashboard_returns_operational_and_real_fee_metrics(monkeypatch) -> None:
    today = date(2026, 7, 17)
    session = _DashboardSession()
    monkeypatch.setattr(dashboard_service, "business_today", lambda: today)

    overview = await dashboard_service.get_dashboard_overview(session)  # type: ignore[arg-type]

    assert session.parameters == {"today": today, "period": "2026-07"}
    assert overview.summary.active_student_count == 32
    assert overview.summary.active_assistant_count == 2
    assert overview.fees.total_amount == 32_000_000
    assert overview.fees.gross_collected_amount == 24_000_000
    assert overview.fees.refunded_amount == 1_000_000
    assert overview.fees.net_collected_amount == 23_000_000
    assert overview.fees.outstanding_amount == 8_000_000
    assert overview.fees.paid_record_count == 24
    assert overview.fees.record_count == 32
    assert len(overview.revenue_trend) == 6
    assert overview.revenue_trend[0].period == "2026-02"
    assert overview.revenue_trend[-1].net_collected_amount == 23_000_000


def test_dashboard_revenue_trend_uses_signed_payment_ledger() -> None:
    sql = str(dashboard_service._DASHBOARD_METRICS_SQL)

    assert "public.payments" in sql
    assert "payment.payment_date" in sql
    assert "sum(payment.amount)" in sql
    assert "interval '5 months'" in sql
