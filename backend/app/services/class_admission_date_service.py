"""Atomic class opening/admission edit with no financial side effects."""

from datetime import date, datetime, timezone
from hashlib import sha256
import hmac
import json
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enrollment import Enrollment
from app.models.start_date_change_command import StartDateChangeCommandRecord
from app.models.student import Student
from app.schemas.class_ import (
    ClassStartDatePreviewRequest,
    ClassStartDateUpdate,
    ClassUpdate,
)
from app.services.admission_date_service import (
    admission_conflict,
    change_admission_date,
)


async def apply_class_admission_date(
    db: AsyncSession,
    id: UUID,
    data: ClassStartDateUpdate,
    *,
    actor_user_id: str | None,
):
    from app.services.class_service import (
        _append_lifecycle_event,
        _clear_dependent_caches,
        _commit_class_changes,
        get_class,
        preview_class_start_date,
        update_class,
    )
    from app.services.enrollment_service import realign_open_slot_selections

    if data.request_id is None or data.enrollment_overrides:
        raise HTTPException(
            422, detail="Yêu cầu mới cần request_id và danh sách admission_dates"
        )
    reason = " ".join(data.reason.replace("\x00", "").split())
    if not 3 <= len(reason) <= 500:
        raise HTTPException(422, detail="Lý do phải có từ 3 đến 500 ký tự")
    payload_hash = sha256(
        json.dumps(
            {
                "class_id": str(id),
                "payload": data.model_dump(mode="json"),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    await db.execute(
        text("select pg_advisory_xact_lock(hashtext(:key))"),
        {
            "key": f"academic-date-command:{data.request_id}",
        },
    )
    class_ = await get_class(db, id, for_update=True)
    if class_ is None:
        return None
    existing = await db.scalar(
        select(StartDateChangeCommandRecord).where(
            StartDateChangeCommandRecord.request_id == str(data.request_id),
        )
    )
    if existing is not None:
        if existing.payload_hash != payload_hash:
            raise admission_conflict(
                "IDEMPOTENCY_PAYLOAD_MISMATCH",
                "Mã yêu cầu đã được dùng cho nội dung khác",
            )
        if existing.state == "COMPLETED":
            return class_
        raise admission_conflict(
            "ADMISSION_COMMAND_IN_PROGRESS", "Yêu cầu đang được xử lý; vui lòng thử lại"
        )

    # Preserve the class -> student -> enrollment ordering used by membership
    # commands. Protect academic edits and financial generation on these rows.
    student_ids = list(
        (
            await db.scalars(
                select(Enrollment.student_id)
                .where(
                    Enrollment.class_id == str(id),
                    Enrollment.status != "cancelled",
                )
                .distinct()
                .order_by(Enrollment.student_id)
            )
        ).all()
    )
    if student_ids:
        await db.execute(
            select(Student.id)
            .where(Student.id.in_(student_ids))
            .order_by(Student.id)
            .with_for_update()
        )
    enrollments = list(
        (
            await db.scalars(
                select(Enrollment)
                .where(
                    Enrollment.class_id == str(id),
                    Enrollment.status != "cancelled",
                )
                .options(selectinload(Enrollment.class_))
                .order_by(Enrollment.id)
                .with_for_update()
            )
        ).all()
    )
    preview = await preview_class_start_date(
        db,
        id,
        ClassStartDatePreviewRequest(
            **data.model_dump(
                include=set(ClassStartDatePreviewRequest.model_fields),
                exclude_unset=True,
            ),
        ),
    )
    if preview is None or not preview.can_apply:
        raise admission_conflict(
            "CLASS_ADMISSION_CONFLICT",
            preview.blocking_reason if preview else "Không tìm thấy lớp",
        )
    if not hmac.compare_digest(preview.preview_fingerprint, data.expected_fingerprint):
        raise admission_conflict(
            "STALE_CLASS_DATE_PREVIEW",
            "Dữ liệu vừa thay đổi. Vui lòng xem lại tác động.",
        )

    old_date = class_.start_date
    if data.class_patch is not None:
        patch_values = data.class_patch.model_dump(
            exclude_unset=True,
            exclude={"start_date", "start_date_change_reason", "expected_fingerprint"},
        )
        patch_values["expected_version"] = class_.version
        patch = ClassUpdate(**patch_values)
        # The nested edit must not commit, release locks or invalidate caches.
        await update_class(db, id, patch, actor_user_id=actor_user_id, commit=False)

    command = StartDateChangeCommandRecord(
        workspace_id=class_.workspace_id,
        request_id=str(data.request_id),
        subject_type="CLASS",
        operation_kind="CLASS_ADMISSION_DATE_CHANGE",
        class_id=str(id),
        old_date=old_date,
        new_date=data.start_date,
        payload_hash=payload_hash,
        preview_fingerprint=data.expected_fingerprint,
        state="PENDING",
        item_count=len(preview.affected_enrollments),
        reason=reason,
        actor_user_id=actor_user_id,
    )
    db.add(command)
    await db.flush()
    by_id = {str(enrollment.id): enrollment for enrollment in enrollments}
    for item in preview.affected_enrollments:
        enrollment = by_id[str(item["enrollment_id"])]
        previous = enrollment.enrollment_date
        next_date = date.fromisoformat(str(item["new_enrollment_date"]))
        await change_admission_date(
            db,
            enrollment,
            next_date=next_date,
            reason=reason,
            expected_version=int(item["admission_version"]),
            actor_user_id=actor_user_id,
            request_id=uuid5(
                NAMESPACE_URL, f"{data.request_id}:admission:{enrollment.id}"
            ),
            parent_command=command,
        )
        await realign_open_slot_selections(
            db, enrollment, class_, previous_start=previous, next_start=next_date
        )

    now = datetime.now(timezone.utc)
    command.state = "COMPLETED"
    command.completed_at = now
    class_.start_date = data.start_date
    class_.version += 1
    _append_lifecycle_event(
        db,
        class_id=class_.id,
        event_type="start_date_changed",
        previous_start_date=old_date,
        next_start_date=data.start_date,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    await _commit_class_changes(db)
    await db.refresh(class_)
    _clear_dependent_caches()
    return class_
