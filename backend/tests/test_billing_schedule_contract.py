from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.billing_schedule_change import (
    BillingScheduleApplyRequest,
    BillingSchedulePreviewRequest,
    FeeDueDateApplyRequest,
)


@pytest.mark.parametrize("reason", ["   ", "\x00\t\n", " a "])
def test_apply_rejects_blank_or_short_normalized_reason(reason):
    with pytest.raises(ValidationError):
        BillingScheduleApplyRequest(
            anchor_date=date(2026, 9, 1),
            expected_version=0,
            strategy="KEEP_CURRENT",
            reason=reason,
            request_id=uuid4(),
            expected_preview_fingerprint="a" * 64,
        )
    with pytest.raises(ValidationError):
        FeeDueDateApplyRequest(
            due_date=date(2026, 9, 1),
            reason=reason,
            request_id=uuid4(),
            expected_preview_fingerprint="a" * 64,
        )


@pytest.mark.parametrize(
    "extra",
    [
        {"strategy": "FROM_CYCLE"},
        {
            "strategy": "CONTINUE_OLD_UNTIL_NEW",
            "first_cycle": 0,
            "apply_from_date": "2026-10-01",
        },
        {"strategy": "REPLACE_CURRENT", "historical_cycles": [-1]},
        {"strategy": "KEEP_CURRENT", "historical_cycles": [0, 0]},
    ],
)
def test_ambiguous_cycle_selections_rejected(extra):
    with pytest.raises(ValidationError):
        BillingSchedulePreviewRequest(
            anchor_date=date(2026, 9, 1), expected_version=0, **extra
        )
