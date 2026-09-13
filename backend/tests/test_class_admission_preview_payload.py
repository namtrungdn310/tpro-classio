from datetime import date
from uuid import uuid4

from app.schemas.class_ import ClassStartDatePreviewRequest, ClassStartDateUpdate


def test_empty_class_patch_stays_empty_when_rebuilding_preview():
    command = ClassStartDateUpdate(
        contract_version=2,
        start_date=date(2026, 9, 1),
        expected_version=1,
        class_patch={},
        admission_dates={},
        reason="Điều chỉnh ngày lớp",
        request_id=uuid4(),
        expected_fingerprint="a" * 64,
    )
    preview = ClassStartDatePreviewRequest(
        **command.model_dump(
            include=set(ClassStartDatePreviewRequest.model_fields), exclude_unset=True
        )
    )
    assert preview.class_patch.model_dump(exclude_unset=True) == {}
