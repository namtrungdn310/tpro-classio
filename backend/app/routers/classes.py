from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.core.rate_limit import enforce_rate_limit
from app.schemas.class_ import (
    ClassCopyTemplateResponse,
    ClassContinuationCreate,
    ClassContinuationCreateResponse,
    ClassContinuationPreviewResponse,
    ClassCreate,
    ClassEndDatePreviewRequest,
    ClassEndDatePreviewResponse,
    ClassEndDateUpdate,
    ClassHistoryResponse,
    ClassResponse,
    ClassScope,
    ClassScopeSummary,
    ClassType,
    ClassUpdate,
    ScheduleAvailabilityRequest,
    ScheduleAvailabilityResponse,
)
from app.services.class_conflict_service import (
    ScheduleDataInvalidError,
    get_class_schedule_availability,
    validate_availability_request_staff,
)
from app.services.class_service import (
    create_class_continuation,
    create_class,
    delete_class,
    get_class_copy_template,
    get_class_history,
    get_class_response,
    get_class_scope_summary,
    get_classes,
    preview_class_end_date,
    preview_class_continuation,
    update_class,
    update_class_end_date,
)

router = APIRouter(tags=["classes"])


@router.post(
    "/schedule-availability",
    response_model=ScheduleAvailabilityResponse,
)
async def get_schedule_availability_route(
    payload: ScheduleAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ScheduleAvailabilityResponse:
    """Lịch bận của nhân sự đã chọn cho form lớp — management-only, không lộ thông
    tin liên hệ nhân sự. Backend vẫn tái kiểm tra khi lưu."""
    await enforce_rate_limit(
        db,
        scope="class_schedule_availability",
        subject=principal.user_id,
        max_attempts=60,
        window_seconds=60,
    )
    try:
        await validate_availability_request_staff(
            db,
            teacher_ids=[str(teacher_id) for teacher_id in payload.teacher_ids],
            assistant_ids=[str(assistant_id) for assistant_id in payload.assistant_ids],
            class_id=str(payload.class_id) if payload.class_id else None,
            scope=payload.scope,
        )
        conflicts = await get_class_schedule_availability(
            db,
            class_id=str(payload.class_id) if payload.class_id else None,
            teacher_ids=[str(teacher_id) for teacher_id in payload.teacher_ids],
            assistant_ids=[str(assistant_id) for assistant_id in payload.assistant_ids],
            start_date=payload.start_date,
            end_date=payload.end_date,
            scope=payload.scope,
        )
    except ValueError as exc:
        if isinstance(exc, ScheduleDataInvalidError):
            detail = f"{exc.code}: {exc}"
        else:
            detail = str(exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=detail,
        ) from exc
    return ScheduleAvailabilityResponse(conflicts=conflicts)


@router.get("", response_model=list[ClassResponse])
async def list_classes(
    search: str | None = Query(default=None, max_length=120),
    type: ClassType | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    scope: ClassScope = Query(default="operational"),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int | None = Query(default=None, ge=0),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[ClassResponse]:
    return await get_classes(
        db,
        search=search,
        type=type,
        is_active=is_active,
        scope=scope,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=ClassScopeSummary)
async def get_class_scope_summary_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassScopeSummary:
    return await get_class_scope_summary(db)


@router.get("/effective-occurrences")
async def get_effective_occurrences_route(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> list[dict]:
    """Effective occurrences của mọi lớp operational trong khoảng ngày (bounded)
    cho dashboard schedule board — projection tối thiểu, không PII."""
    if to_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ngày kết thúc phải sau ngày bắt đầu",
        )
    if (to_date - from_date).days > 120:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Khoảng ngày không được vượt quá 120 ngày",
        )
    from app.services.class_makeup_service import (
        get_effective_occurrences_for_range,
    )

    results = await get_effective_occurrences_for_range(db, from_date, to_date)
    return [
        {
            "class_id": str(item.class_id),
            "occurrences": [
                {
                    "key": occurrence.key,
                    "kind": occurrence.kind,
                    "original_start_at": occurrence.original_start_at.isoformat(),
                    "original_end_at": occurrence.original_end_at.isoformat(),
                    "source_slot_key": occurrence.source_slot_key,
                    "exception_id": occurrence.exception_id,
                    "status": occurrence.status,
                    "replacement_start_at": (
                        occurrence.replacement_start_at.isoformat()
                        if occurrence.replacement_start_at
                        else None
                    ),
                    "replacement_end_at": (
                        occurrence.replacement_end_at.isoformat()
                        if occurrence.replacement_end_at
                        else None
                    ),
                }
                for occurrence in item.occurrences
            ],
        }
        for item in results
    ]


@router.get("/{id}/copy-template", response_model=ClassCopyTemplateResponse)
async def get_class_copy_template_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassCopyTemplateResponse:
    template = await get_class_copy_template(db, id)
    if template is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return template


@router.get(
    "/{id}/continuation-preview",
    response_model=ClassContinuationPreviewResponse,
)
async def preview_class_continuation_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassContinuationPreviewResponse:
    try:
        preview = await preview_class_continuation(db, id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    if preview is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return preview


@router.post(
    "/{id}/continuation",
    response_model=ClassContinuationCreateResponse,
)
async def create_class_continuation_route(
    id: UUID,
    payload: ClassContinuationCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassContinuationCreateResponse:
    await enforce_rate_limit(
        db,
        scope="class_mutation",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        class_, enrolled_count = await create_class_continuation(
            db,
            id,
            payload,
            actor_user_id=principal.user_id,
        )
    except ValueError as exc:
        detail = str(exc)
        conflict = any(
            marker in detail
            for marker in (
                "vừa được cập nhật",
                "đã tồn tại",
                "đã được sử dụng",
                "trùng",
            )
        )
        raise HTTPException(
            status_code=(
                status.HTTP_409_CONFLICT
                if conflict
                else status.HTTP_422_UNPROCESSABLE_CONTENT
            ),
            detail=detail,
        ) from exc
    created = await get_class_response(db, UUID(str(class_.id)))
    if created is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học vừa tạo",
        )
    return ClassContinuationCreateResponse(
        created_class=created,
        enrolled_student_count=enrolled_count,
    )


@router.get("/{id}", response_model=ClassResponse)
async def get_class_detail_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassResponse:
    class_ = await get_class_response(db, id)
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return class_


@router.get("/{id}/history", response_model=ClassHistoryResponse)
async def get_class_history_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassHistoryResponse:
    history = await get_class_history(db, id)
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return history


@router.post("", response_model=ClassResponse)
async def create_class_route(
    payload: ClassCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassResponse:
    await enforce_rate_limit(
        db,
        scope="class_mutation",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        class_ = await create_class(
            db,
            payload,
            actor_user_id=principal.user_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    created = await get_class_response(db, UUID(str(class_.id)))
    if created is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return created


@router.patch("/{id}", response_model=ClassResponse)
async def update_class_route(
    id: UUID,
    payload: ClassUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassResponse:
    await enforce_rate_limit(
        db,
        scope="class_mutation",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        class_ = await update_class(
            db,
            id,
            payload,
            actor_user_id=principal.user_id,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = (
            status.HTTP_409_CONFLICT
            if "vừa được cập nhật" in detail
            or "đã bị khóa" in detail
            or "học phí" in detail
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        )
        raise HTTPException(
            status_code=status_code,
            detail=detail,
        ) from exc
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    updated = await get_class_response(db, id)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return updated


@router.patch("/{id}/end-date", response_model=ClassResponse)
async def update_class_end_date_route(
    id: UUID,
    payload: ClassEndDateUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassResponse:
    try:
        class_ = await update_class_end_date(
            db,
            id,
            payload,
            actor_user_id=principal.user_id,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = (
            status.HTTP_409_CONFLICT
            if "khóa" in detail or "vừa được cập nhật" in detail or "học phí" in detail
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    updated = await get_class_response(db, id)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return updated


@router.post("/{id}/end-date/preview", response_model=ClassEndDatePreviewResponse)
async def preview_class_end_date_route(
    id: UUID,
    payload: ClassEndDatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassEndDatePreviewResponse:
    try:
        preview = await preview_class_end_date(db, id, payload)
    except ValueError as exc:
        detail = str(exc)
        status_code = (
            status.HTTP_409_CONFLICT
            if "khóa" in detail or "vừa được cập nhật" in detail or "học phí" in detail
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
    if preview is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )
    return preview


@router.delete("/{id}")
async def delete_class_route(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> dict[str, str]:
    class_ = await delete_class(
        db,
        id,
        actor_user_id=principal.user_id,
    )
    if class_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lớp học",
        )

    return {"message": "Đã xoá lớp học"}
