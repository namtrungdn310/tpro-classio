from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.class_ import Class
from app.models.enrollment import Enrollment
from app.schemas.class_ import ClassCreate, ClassResponse, ClassUpdate

_CACHE_TTL = timedelta(minutes=2)
_classes_cache: dict[
    tuple[str | None, str | None, bool | None],
    tuple[datetime, list[ClassResponse]],
] = {}


def clear_classes_cache() -> None:
    _classes_cache.clear()


def _to_response(class_: Class, student_count: int = 0) -> ClassResponse:
    return ClassResponse(
        id=class_.id,
        name=class_.name,
        type=class_.type,
        base_fee=int(class_.base_fee),
        billing_cycle_months=class_.billing_cycle_months,
        start_date=class_.start_date,
        end_date=class_.end_date,
        schedule=class_.schedule,
        is_active=class_.is_active,
        student_count=student_count,
        created_at=class_.created_at,
    )


async def get_classes(
    db: AsyncSession,
    search: str | None = None,
    type: str | None = None,
    is_active: bool | None = None,
) -> list[ClassResponse]:
    cache_key = (search or None, type or None, is_active)
    cached = _classes_cache.get(cache_key)
    if cached:
        cached_at, cached_classes = cached
        if datetime.now(timezone.utc) - cached_at < _CACHE_TTL:
            return cached_classes

    active_enrollment_count = func.count(Enrollment.id).label("student_count")
    statement = (
        select(Class, active_enrollment_count)
        .outerjoin(
            Enrollment,
            and_(Enrollment.class_id == Class.id, Enrollment.status == "active"),
        )
        .group_by(Class.id)
        .order_by(Class.created_at.desc())
    )

    if search:
        statement = statement.where(Class.name.ilike(f"%{search}%"))
    if type:
        statement = statement.where(Class.type == type)
    if is_active is not None:
        statement = statement.where(Class.is_active == is_active)

    result = await db.execute(statement)
    classes = [_to_response(class_, student_count) for class_, student_count in result.all()]
    _classes_cache[cache_key] = (datetime.now(timezone.utc), classes)
    return classes


async def get_class(db: AsyncSession, id: UUID) -> Class | None:
    result = await db.execute(select(Class).where(Class.id == str(id)))
    return result.scalar_one_or_none()


async def create_class(db: AsyncSession, data: ClassCreate) -> Class:
    payload = data.model_dump()
    if payload["type"] == "MONTHLY":
        payload["billing_cycle_months"] = 1

    class_ = Class(**payload)
    db.add(class_)
    await db.commit()
    await db.refresh(class_)
    clear_classes_cache()
    return class_


async def update_class(db: AsyncSession, id: UUID, data: ClassUpdate) -> Class | None:
    class_ = await get_class(db, id)
    if class_ is None:
        return None

    payload = data.model_dump(exclude_unset=True)
    next_type = payload.get("type", class_.type)
    if next_type == "MONTHLY":
        payload["billing_cycle_months"] = 1

    for field, value in payload.items():
        setattr(class_, field, value)

    await db.commit()
    await db.refresh(class_)
    clear_classes_cache()
    return class_


async def soft_delete_class(db: AsyncSession, id: UUID) -> Class | None:
    class_ = await get_class(db, id)
    if class_ is None:
        return None

    class_.is_active = False
    await db.commit()
    await db.refresh(class_)
    clear_classes_cache()
    return class_
