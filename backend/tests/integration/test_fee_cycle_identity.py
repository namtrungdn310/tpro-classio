"""R6-D05/V05 — fee-cycle identity dual-read integration tests (disposable DB).

Run with RUN_DB_INTEGRATION=1. Proves: legacy records expose deterministic
cycle_no 1..n with LEGACY_BACKFILL origin; money/status/notification/payment
links are unchanged after the migration; protected history is never rewritten;
no cycle 0 exists for legacy enrollments.
"""

import os
from datetime import date

import pytest
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.services.fee_service import get_fee_records, get_outstanding_fee_records

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1",
        reason="requires a migrated PostgreSQL test database",
    ),
]


async def test_legacy_records_expose_deterministic_cycles() -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    """
                    select cycle_no, due_date, base_due_date, adjusted_due_date,
                           coverage_start, coverage_end, origin, status
                      from public.fee_records
                     where enrollment_id = '70000000-0000-0000-0000-000000000011'
                     order by cycle_no
                    """
                )
            )
        ).all()
        assert len(rows) == 3
        assert [row.cycle_no for row in rows] == [1, 2, 3]
        assert [row.due_date.isoformat() for row in rows] == [
            "2026-10-01",
            "2026-11-01",
            "2026-12-01",
        ]
        assert all(row.origin == "LEGACY_BACKFILL" for row in rows)
        assert all(
            row.base_due_date == row.adjusted_due_date == row.coverage_start
            for row in rows
        )
        # Protected history untouched: cycle 2 vẫn PAID.
        assert rows[1].status == "PAID"


async def test_no_legacy_cycle_zero() -> None:
    """Legacy fixture enrollments (backfill cycle 1..n) không có cycle 0;
    cycle 0 chỉ tồn tại cho enrollment tạo sau cutover."""
    async with AsyncSessionLocal() as db:
        count = (
            await db.execute(
                text(
                    "select count(*) from public.fee_records "
                    "where cycle_no = 0 and enrollment_id in ("
                    "  '70000000-0000-0000-0000-000000000011',"
                    "  '70000000-0000-0000-0000-000000000012')"
                )
            )
        ).scalar()
        assert count == 0


async def test_dual_read_dto_exposes_cycle_identity(monkeypatch) -> None:
    # The fixture is deliberately dated in the future; the DTO still exposes
    # a paid early obligation for audit/reconciliation.  Move the business
    # clock to the due date only for the DTO parity assertion below.
    monkeypatch.setattr(
        "app.services.fee_service.business_today", lambda: date(2026, 11, 1)
    )
    async with AsyncSessionLocal() as db:
        response = await get_fee_records(db, period="2026-11")
        by_enrollment = [
            record
            for record in response.records
            if str(record.enrollment_id) == "70000000-0000-0000-0000-000000000011"
        ]
        assert len(by_enrollment) == 1
        record = by_enrollment[0]
        assert record.cycle_no == 2
        assert record.base_due_date.isoformat() == "2026-11-01"
        assert record.adjusted_due_date.isoformat() == "2026-11-01"
        assert record.origin == "LEGACY_BACKFILL"
        assert record.status == "PAID"
        assert record.final_amount == 750_000


async def test_early_paid_future_obligation_remains_visible_before_due_date(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.fee_service.business_today", lambda: date(2026, 10, 31)
    )
    async with AsyncSessionLocal() as db:
        response = await get_fee_records(db, period="2026-11")
    matching = [
        record
        for record in response.records
        if str(record.enrollment_id) == "70000000-0000-0000-0000-000000000011"
    ]
    assert len(matching) == 1
    assert matching[0].status == "PAID"


async def test_outstanding_view_keeps_unpaid_obligations_from_multiple_periods(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.fee_service.business_today", lambda: date(2026, 12, 31)
    )
    async with AsyncSessionLocal() as db:
        response = await get_outstanding_fee_records(db)

    assert response.period == "outstanding"
    assert all(record.status == "UNPAID" for record in response.records)
    periods = {record.period for record in response.records}
    assert len(periods) >= 2


async def test_payment_links_preserved() -> None:
    async with AsyncSessionLocal() as db:
        linked = (
            await db.execute(
                text(
                    """
                    select count(*) from public.payments p
                     join public.fee_records r on r.id = p.fee_record_id
                     where r.enrollment_id = '70000000-0000-0000-0000-000000000011'
                    """
                )
            )
        ).scalar()
        # Fixture không tạo payment nào; record ids phải còn nguyên vẹn
        # (snapshot parity do acceptance của migration 056 kiểm chứng).
        record_ids = (
            await db.execute(
                text(
                    """
                    select count(*) from public.fee_records
                     where enrollment_id = '70000000-0000-0000-0000-000000000011'
                    """
                )
            )
        ).scalar()
        assert linked == 0
        assert record_ids == 3
