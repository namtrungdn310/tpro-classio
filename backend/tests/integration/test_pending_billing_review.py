"""Pending review correction is explicit, atomic and tested on disposable SQL."""

import os
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.core.business_time import business_today
from app.core.database import AsyncSessionLocal
from app.models.billing_anchor_revision import BillingAnchorRevision
from app.schemas.enrollment import EnrollmentCreate
from app.schemas.billing_anchor import BillingReviewResolveRequest
from app.schemas.billing_schedule_change import (
    BillingScheduleOptionsRequest,
    BillingSchedulePreviewRequest,
    BillingScheduleApplyRequest,
)
from app.services.billing_anchor_service import (
    list_billing_reviews,
    resolve_billing_review,
)
from app.services.billing_schedule_change_service import (
    analyze_billing_schedule_options,
    preview_billing_schedule,
    apply_billing_schedule,
    load_billing_context,
)
from app.services.enrollment_service import create_enrollment
from app.services.fee_cycle_service import ensure_enrollment_cycles
from test_billing_cycles import _make_operational_class, _make_student
from test_membership_transitions import _financial_snapshot

pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(
        os.getenv("RUN_DB_INTEGRATION") != "1", reason="disposable PostgreSQL only"
    ),
]


async def pending_enrollment(db):
    today = business_today()
    class_id, _ = await _make_operational_class(db, start=today - timedelta(days=90))
    student_id = await _make_student(db, uuid4().hex)
    return await create_enrollment(
        db,
        EnrollmentCreate(
            class_id=UUID(class_id),
            student_id=UUID(student_id),
            enrollment_date=today - timedelta(days=10),
        ),
    )


@pytest.mark.parametrize("strategy", ["KEEP_CURRENT", "REPLACE_CURRENT"])
async def test_pending_anchor_preview_apply_retry_and_worker(monkeypatch, strategy):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment = await pending_enrollment(db)
        original = await _financial_snapshot(db, enrollment.id)
        options = await analyze_billing_schedule_options(
            db,
            enrollment.id,
            BillingScheduleOptionsRequest(
                anchor_date=business_today() + timedelta(days=5), expected_version=0
            ),
        )
        assert not options.is_blocked
        pending = options.pending_review
        assert pending and pending.change_kind == "INITIAL_BACKDATED"
        assert any(o.strategy == strategy and o.is_allowed for o in options.options)
        draft = dict(
            anchor_date=options.new_anchor_date,
            expected_version=0,
            strategy=strategy,
            gap_policy="WAIVE",
            reason="Sửa mốc lịch đang chờ",
            expected_context_token=options.context_token,
        )
        with pytest.raises(HTTPException) as exc:
            await preview_billing_schedule(
                db, enrollment.id, BillingSchedulePreviewRequest(**draft)
            )
        assert exc.value.detail["code"] == "BILLING_REVIEW_PENDING"
        draft["expected_pending_review_id"] = pending.id
        preview = await preview_billing_schedule(
            db, enrollment.id, BillingSchedulePreviewRequest(**draft)
        )
        assert preview.can_apply and preview.pending_review.id == pending.id
        assert await _financial_snapshot(db, enrollment.id) == original
        command = BillingScheduleApplyRequest(
            **draft,
            request_id=uuid4(),
            expected_preview_fingerprint=preview.preview_fingerprint,
        )
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        after = await _financial_snapshot(db, enrollment.id)
        await apply_billing_schedule(db, enrollment.id, command, actor_user_id=None)
        assert await _financial_snapshot(db, enrollment.id) == after
        old = await db.get(BillingAnchorRevision, str(pending.id))
        assert old.state == "SUPERSEDED" and old.resolved_at
        current, records, _ = await load_billing_context(db, enrollment.id, lock=True)
        assert current.current_billing_revision.state == "CONFIRMED"
        assert not any(
            f.review_required
            for f in records
            if str(f.billing_revision_id) == str(pending.id)
        )
        assert str(current.current_billing_revision.id) in old.resolution_note
        first = next(c for c in preview.plan.charges if c.kind == "CYCLE")
        generated = await ensure_enrollment_cycles(
            db, current, up_to=first.coverage.end + timedelta(days=1)
        )
        assert generated
        await db.rollback()


async def test_waive_keeps_schedule_pending_even_when_no_fees_remain():
    async with AsyncSessionLocal() as db:
        enrollment = await pending_enrollment(db)
        reviews = await list_billing_reviews(db)
        review = next(
            r for r in reviews.reviews if str(r.enrollment_id) == str(enrollment.id)
        )
        assert review.change_kind == "INITIAL_BACKDATED" and review.fees
        result = await resolve_billing_review(
            db,
            review.id,
            BillingReviewResolveRequest(
                decision="WAIVE_CHARGE",
                fee_record_ids=[f.id for f in review.fees],
                reason="Không thu khoản cũ",
                expected_context_token=review.context_token,
            ),
            actor_user_id=None,
        )
        assert result.state == "PENDING" and not result.fees
        with pytest.raises(HTTPException):
            await resolve_billing_review(
                db,
                review.id,
                BillingReviewResolveRequest(
                    decision="CONFIRM", expected_context_token=review.context_token
                ),
                actor_user_id=None,
            )
        result = await resolve_billing_review(
            db,
            review.id,
            BillingReviewResolveRequest(
                decision="CONFIRM", expected_context_token=result.context_token
            ),
            actor_user_id=None,
        )
        assert result.state == "CONFIRMED"


async def test_standalone_confirmation_invalidates_pending_anchor_preview(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "independent_billing_dates_enabled", True)
    async with AsyncSessionLocal() as db:
        enrollment = await pending_enrollment(db)
        options = await analyze_billing_schedule_options(
            db,
            enrollment.id,
            BillingScheduleOptionsRequest(
                anchor_date=business_today() + timedelta(days=5), expected_version=0
            ),
        )
        option = next(o for o in options.options if o.is_allowed)
        draft = dict(
            anchor_date=options.new_anchor_date,
            expected_version=0,
            strategy=option.strategy,
            gap_policy="WAIVE",
            reason="Sửa mốc lịch chờ",
            expected_context_token=options.context_token,
            expected_pending_review_id=options.pending_review.id,
        )
        preview = await preview_billing_schedule(
            db, enrollment.id, BillingSchedulePreviewRequest(**draft)
        )
        await resolve_billing_review(
            db,
            options.pending_review.id,
            BillingReviewResolveRequest(decision="CONFIRM"),
            actor_user_id=None,
        )
        before = await _financial_snapshot(db, enrollment.id)
        with pytest.raises(HTTPException):
            await apply_billing_schedule(
                db,
                enrollment.id,
                BillingScheduleApplyRequest(
                    **draft,
                    request_id=uuid4(),
                    expected_preview_fingerprint=preview.preview_fingerprint,
                ),
                actor_user_id=None,
            )
        assert await _financial_snapshot(db, enrollment.id) == before
        await db.rollback()
