"""Read model accepts years of data without changing financial rows."""

import json
import os
from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.workspace import set_workspace_id, reset_workspace_id
from app.services.billing_schedule_read_service import (
    read_schedule_fees,
    read_schedule_summary,
)
from app.services.billing_schedule_read_service import (
    read_report_enrollments,
    read_schedule_history,
)
from test_membership_transitions import (
    _make_independent_membership,
    _financial_snapshot,
)

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="isolated PostgreSQL only"
    ),
]


async def test_ten_year_listing_filters_order_pages_and_preserves_financial_state(
    monkeypatch,
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        try:
            # 120 monthly rows with random IDs; calendar order cannot come from IDs.
            await db.execute(
                text("""
                insert into fee_records (enrollment_id, period, cycle_no, due_date, base_due_date,
                  adjusted_due_date, coverage_start, coverage_end, origin, base_amount, discount_amount,
                  status, paid_amount, paid_date, refunded_amount, voided_at, superseded_at,
                  student_name_snapshot, class_name_snapshot, class_type_snapshot, billing_cycle_months_snapshot,
                  enrollment_date_snapshot)
                select cast(:id as uuid), to_char(d,'YYYY-MM'), n, d, d,
                  case when n=1 then date '2030-01-01' else d end, d, d+interval '1 month',
                  'LEGACY_BACKFILL', 750000, 0,
                  (case when n=2 then 'PAID' when n=3 then 'VOID' when n=4 then 'SUPERSEDED' when n=5 then 'PAID' else 'UNPAID' end)::fee_status,
                  case when n in (2,5) then 750000 else null end,
                  case when n in (2,5) then d else null end,
                  case when n=5 then 250000 else 0 end,
                  case when n=3 then now() else null end,
                  case when n=4 then now() else null end,
                  'Listing fixture', 'Listing fixture', 'MONTHLY', 1, :admission
                from (select n, (date '2016-01-01'+ (n-1)*interval '1 month')::date d from generate_series(1,120) n) x
            """),
                {"id": enrollment.id, "admission": enrollment.enrollment_date},
            )
            await db.commit()
            before = await _financial_snapshot(db, enrollment.id)
            summary = await read_schedule_summary(db, enrollment.id)
            assert "fees" not in summary and "history" not in summary
            assert len(json.dumps(summary, default=str)) < 10000
            collected = []
            for page in range(1, 8):
                result = await read_schedule_fees(
                    db,
                    enrollment.id,
                    year=0,
                    include_inactive=True,
                    order="asc",
                    page=page,
                )
                assert len(result["items"]) <= 20
                assert len(json.dumps(result, default=str)) < 20000
                collected.extend(result["items"])
                if not result["has_next"]:
                    break
            assert len(collected) == 121
            assert len({r["id"] for r in collected}) == 121
            assert [r["coverage_start"] for r in collected] == sorted(
                r["coverage_start"] for r in collected
            )
            # Changing a collection deadline to 2030 does not move the 2016 cycle.
            result = await read_schedule_fees(
                db, enrollment.id, year=2016, include_inactive=True, order="asc"
            )
            assert result["total"] == 12
            assert result["items"][0]["due_date"] == date(2030, 1, 1)
            assert (await read_schedule_fees(db, enrollment.id, year=2016))[
                "total"
            ] == 10
            assert (
                await read_schedule_fees(db, enrollment.id, year=2016, state="PAID")
            )["total"] == 1
            refunded = await read_schedule_fees(
                db, enrollment.id, year=2016, state="REFUNDED"
            )
            assert refunded["total"] == 1 and refunded["items"][0]["protected"]
            pending = await read_schedule_fees(
                db, enrollment.id, year=0, state="PENDING", include_inactive=True
            )
            assert pending["total"] == 117
            recent = await read_schedule_fees(
                db, enrollment.id, year=2025, state="PAID"
            )
            assert recent["total"] == 0 and recent["older_pending_count"] == 104
            assert recent["available_years"] == sorted(
                recent["available_years"], reverse=True
            )
            # Last page is clamped after rows are removed from the active filter.
            last = await read_schedule_fees(db, enrollment.id, year=2016, page=999)
            assert last["page"] == 1 and not last["has_next"]
            assert await _financial_snapshot(db, enrollment.id) == before
            # All new reads must still enforce tenant isolation.
            token = set_workspace_id(str(uuid4()))
            try:
                with pytest.raises(HTTPException) as caught:
                    await read_schedule_fees(db, enrollment.id)
                assert caught.value.status_code == 404
            finally:
                reset_workspace_id(token)
        finally:
            await db.execute(
                text("delete from public.fee_records where enrollment_id = :id"),
                {"id": enrollment.id},
            )
            await db.commit()


async def test_unknown_enrollment_has_no_list_metadata(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        with pytest.raises(HTTPException) as caught:
            await read_schedule_summary(db, UUID(str(uuid4())))
        assert caught.value.status_code == 404


async def test_report_history_is_paginated_scoped_and_uses_operation_year(monkeypatch):
    from datetime import datetime, timezone
    from app.core.config import settings
    from app.models.start_date_change_command import StartDateChangeCommandRecord

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment, _, _ = await _make_independent_membership(db)
        before = await _financial_snapshot(db, enrollment.id)
        for n in range(25):
            db.add(
                StartDateChangeCommandRecord(
                    request_id=str(uuid4()),
                    subject_type="STUDENT",
                    operation_kind="BILLING_SCHEDULE_CHANGE",
                    student_id=enrollment.student_id,
                    class_id=enrollment.class_id,
                    old_date=date(2020, 1, 1),
                    new_date=date(2020, 2, 1),
                    reason="Report audit fixture",
                    payload_hash="a" * 64,
                    preview_fingerprint="b" * 64,
                    state="COMPLETED",
                    completed_at=datetime(2025, 12, 31, 17, n, tzinfo=timezone.utc),
                    created_at=datetime(2025, 12, 31, 17, n, tzinfo=timezone.utc),
                    execution_plan={
                        "response": {
                            "plan": {
                                "enrollment_id": str(enrollment.id),
                                "keep_ids": [],
                                "supersede_ids": [],
                                "charges": [],
                                "waived_intervals": [],
                            }
                        },
                        "created_fee_ids": [],
                    },
                )
            )
        await db.commit()
        first = await read_schedule_history(db, enrollment.id, year=2026)
        second = await read_schedule_history(db, enrollment.id, year=2026, page=2)
        assert first["total"] == 25 and first["has_next"] and len(first["items"]) == 20
        assert len(second["items"]) == 5 and not second["has_next"]
        assert not (
            {r["id"] for r in first["items"]} & {r["id"] for r in second["items"]}
        )
        assert (await read_schedule_history(db, enrollment.id, year=2025))["total"] == 0
        assert (await read_schedule_history(db, enrollment.id, year=0))["total"] == 25
        assert await _financial_snapshot(db, enrollment.id) == before
        assert "history" not in await read_schedule_summary(db, enrollment.id)
        assert len((await read_report_enrollments(db))["items"]) <= 20
        assert (await read_report_enrollments(db, q="no-such-" + str(uuid4())))[
            "total"
        ] == 0
        token = set_workspace_id(str(uuid4()))
        try:
            assert (await read_report_enrollments(db))["total"] == 0
            with pytest.raises(HTTPException) as caught:
                await read_schedule_history(db, enrollment.id)
            assert caught.value.status_code == 404
        finally:
            reset_workspace_id(token)
