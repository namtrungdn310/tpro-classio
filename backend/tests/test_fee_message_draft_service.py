from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.fee_message_draft_service import _source_payload, _validate_group


def _record(
    *, student_id: str = "student-1", period: str = "2026-08", status: str = "UNPAID"
):
    return SimpleNamespace(
        id=f"fee-{student_id}-{status}",
        period=period,
        status=status,
        final_amount=750_000,
        refunded_amount=0,
        adjusted_due_date=None,
        due_date=None,
        class_name_snapshot="6C1",
        student_name_snapshot="Nguyễn Minh Tuấn",
        enrollment=SimpleNamespace(
            student_id=student_id,
            student=SimpleNamespace(full_name="Nguyễn Minh Tuấn"),
            class_=SimpleNamespace(name="6C1"),
        ),
    )


def test_message_draft_group_requires_one_student_and_period():
    with pytest.raises(HTTPException, match="một học viên"):
        _validate_group(
            [_record(student_id="student-1"), _record(student_id="student-2")],
            kind="reminder",
        )

    with pytest.raises(HTTPException, match="một học viên"):
        _validate_group(
            [_record(period="2026-08"), _record(period="2026-09")],
            kind="reminder",
        )


def test_message_draft_kind_rejects_mixed_or_wrong_fee_states():
    with pytest.raises(HTTPException, match="chưa nộp"):
        _validate_group([_record(status="PAID")], kind="reminder")

    with pytest.raises(HTTPException, match="đã nộp"):
        _validate_group([_record(status="UNPAID")], kind="received")

    assert _validate_group([_record(status="UNPAID")], kind="reminder") == (
        "student-1",
        "2026-08",
    )
    assert _validate_group([_record(status="PAID")], kind="received") == (
        "student-1",
        "2026-08",
    )


def test_source_payload_is_stable_across_record_order(monkeypatch):
    monkeypatch.setattr(
        "app.services.fee_message_draft_service.get_workspace_id",
        lambda: "workspace-1",
    )
    first = _record()
    second = _record()
    first.id = "fee-2"
    second.id = "fee-1"
    first.class_name_snapshot = "7C2"
    second.class_name_snapshot = "6C1"

    forward = _source_payload([first, second], "reminder", "template-hash")
    reverse = _source_payload([second, first], "reminder", "template-hash")

    assert forward == reverse
    assert forward["workspace_id"] == "workspace-1"
    assert [item["id"] for item in forward["records"]] == ["fee-1", "fee-2"]
