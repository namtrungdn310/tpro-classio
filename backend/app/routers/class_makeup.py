"""HTTP contract for class postponement / make-up commands and read models.

Router functions contain only transport + authorization orchestration; business
rules live in the make-up service. Errors use stable machine codes:
{"code": ..., "message": ...} and never expose SQL/stack/internal table names.
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.core.rate_limit import enforce_rate_limit
from app.schemas.makeup import (
    AdjustmentStatus,
    ClassAdjustmentListResponse,
    ClassOccurrenceListResponse,
    ClassSessionExceptionResponse,
    ExceptionCommandResponse,
    MakeupDomainError,
    MakeupSchedulePreviewRequest,
    MakeupSchedulePreviewResponse,
    MakeupScheduleRequest,
    MakeupUnscheduleRequest,
    MakeupCompleteRequest,
    PostponementCreateRequest,
    PostponementCreateResponse,
    PostponementPreviewRequest,
    PostponementPreviewResponse,
    RestoreOriginalRequest,
)
from app.services.class_makeup_service import (
    complete_makeup,
    create_postponement,
    get_class_effective_occurrences,
    get_class_session_exception,
    list_class_adjustments,
    preview_makeup_schedule,
    preview_postponement,
    restore_original_session,
    schedule_makeup,
    unschedule_makeup,
)

router = APIRouter(tags=["class-makeup"])
exception_router = APIRouter(tags=["class-session-exceptions"])

CONFLICT_CODES = {
    "CLASS_VERSION_CONFLICT",
    "OCCURRENCE_ALREADY_ADJUSTED",
    "INVALID_TRANSITION",
    "MAKEUP_DURATION_MISMATCH",
    "STAFF_SCHEDULE_CONFLICT",
    "CLASS_SCHEDULE_CONFLICT",
    "MAKEUP_NOT_FINISHED",
    "UNRESOLVED_MAKEUPS",
    "RESTORE_NOT_ALLOWED",
    "STAFF_INACTIVE",
    "REQUEST_ALREADY_PROCESSED",
}


def _makeup_http_error(exc: MakeupDomainError) -> HTTPException:
    code = str(exc.code)
    http_status = (
        status.HTTP_409_CONFLICT
        if code in CONFLICT_CODES
        else status.HTTP_422_UNPROCESSABLE_CONTENT
    )
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": str(exc)},
    )


async def _run_mutation(
    db: AsyncSession,
    principal: Principal,
    *,
    scope: str,
    action,
) -> ExceptionCommandResponse:
    await enforce_rate_limit(
        db,
        scope=scope,
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        return await action(actor_user_id=principal.user_id)
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{class_id}/occurrences",
    response_model=ClassOccurrenceListResponse,
)
async def get_occurrences_route(
    class_id: UUID,
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassOccurrenceListResponse:
    if to_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "OCCURRENCE_NOT_FOUND",
                "message": "Ngày kết thúc phải sau ngày bắt đầu",
            },
        )
    if (to_date - from_date).days > 120:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "OCCURRENCE_NOT_FOUND",
                "message": "Khoảng ngày không được vượt quá 120 ngày",
            },
        )
    try:
        return await get_class_effective_occurrences(db, class_id, from_date, to_date)
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


@router.get(
    "/{class_id}/schedule-adjustments",
    response_model=ClassAdjustmentListResponse,
)
async def list_adjustments_route(
    class_id: UUID,
    status_filter: AdjustmentStatus | None = Query(default=None, alias="status"),
    cursor: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassAdjustmentListResponse:
    try:
        return await list_class_adjustments(
            db,
            class_id,
            status=status_filter,
            cursor=cursor,
            limit=limit,
        )
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


@exception_router.get(
    "/{exception_id}",
    response_model=ClassSessionExceptionResponse,
)
async def get_exception_route(
    exception_id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ClassSessionExceptionResponse:
    exception = await get_class_session_exception(db, exception_id)
    if exception is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "OCCURRENCE_NOT_FOUND",
                "message": "Không tìm thấy buổi học",
            },
        )
    return exception


# ---------------------------------------------------------------------------
# Command endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/{class_id}/schedule-adjustments/preview",
    response_model=PostponementPreviewResponse,
)
async def preview_postponement_route(
    class_id: UUID,
    payload: PostponementPreviewRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PostponementPreviewResponse:
    await enforce_rate_limit(
        db,
        scope="class_makeup_preview",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        return await preview_postponement(db, class_id, payload)
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


@router.post(
    "/{class_id}/schedule-adjustments",
    response_model=PostponementCreateResponse,
)
async def create_postponement_route(
    class_id: UUID,
    payload: PostponementCreateRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> PostponementCreateResponse:
    await enforce_rate_limit(
        db,
        scope="class_makeup_mutation",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        return await create_postponement(
            db,
            class_id,
            payload,
            actor_user_id=principal.user_id,
        )
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


@exception_router.post(
    "/{exception_id}/makeup/preview",
    response_model=MakeupSchedulePreviewResponse,
)
async def preview_makeup_schedule_route(
    exception_id: UUID,
    payload: MakeupSchedulePreviewRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> MakeupSchedulePreviewResponse:
    await enforce_rate_limit(
        db,
        scope="class_makeup_preview",
        subject=principal.user_id,
        max_attempts=120,
        window_seconds=60,
    )
    try:
        return await preview_makeup_schedule(db, exception_id, payload)
    except MakeupDomainError as exc:
        raise _makeup_http_error(exc) from exc


@exception_router.post(
    "/{exception_id}/makeup/schedule",
    response_model=ExceptionCommandResponse,
)
async def schedule_makeup_route(
    exception_id: UUID,
    payload: MakeupScheduleRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ExceptionCommandResponse:
    return await _run_mutation(
        db,
        principal,
        scope="class_makeup_mutation",
        action=lambda actor_user_id: schedule_makeup(
            db, exception_id, payload, actor_user_id=actor_user_id
        ),
    )


@exception_router.post(
    "/{exception_id}/makeup/unschedule",
    response_model=ExceptionCommandResponse,
)
async def unschedule_makeup_route(
    exception_id: UUID,
    payload: MakeupUnscheduleRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ExceptionCommandResponse:
    return await _run_mutation(
        db,
        principal,
        scope="class_makeup_mutation",
        action=lambda actor_user_id: unschedule_makeup(
            db, exception_id, payload, actor_user_id=actor_user_id
        ),
    )


@exception_router.post(
    "/{exception_id}/makeup/complete",
    response_model=ExceptionCommandResponse,
)
async def complete_makeup_route(
    exception_id: UUID,
    payload: MakeupCompleteRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ExceptionCommandResponse:
    return await _run_mutation(
        db,
        principal,
        scope="class_makeup_mutation",
        action=lambda actor_user_id: complete_makeup(
            db, exception_id, payload, actor_user_id=actor_user_id
        ),
    )


@exception_router.post(
    "/{exception_id}/restore-original",
    response_model=ExceptionCommandResponse,
)
async def restore_original_route(
    exception_id: UUID,
    payload: RestoreOriginalRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> ExceptionCommandResponse:
    return await _run_mutation(
        db,
        principal,
        scope="class_makeup_mutation",
        action=lambda actor_user_id: restore_original_session(
            db, exception_id, payload, actor_user_id=actor_user_id
        ),
    )
