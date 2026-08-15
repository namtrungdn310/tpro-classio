import hashlib
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.phone import normalize_vietnam_phone
from app.core.search import normalize_search_text
from app.core.class_lifecycle import is_operational_class
from app.models.enrollment import Enrollment
from app.models.student import Student
from app.schemas.student import (
    StudentCreate,
    StudentIdentityCandidate,
    StudentIdentityConflict,
    StudentIdentityMatchStrength,
    StudentPreviousClass,
)

_CANDIDATE_POOL_LIMIT = 50
_CANDIDATE_RESPONSE_LIMIT = 5


@dataclass(frozen=True)
class _ScoredCandidate:
    student: Student
    score: int
    strength: StudentIdentityMatchStrength
    reason: str


def _phone_digits(column):
    return func.regexp_replace(func.coalesce(column, ""), r"\D", "", "g")


def _mask_phone(value: str | None) -> str | None:
    normalized = normalize_vietnam_phone(value)
    if not normalized:
        return None
    visible = normalized[-4:]
    return f"{'*' * max(0, len(normalized) - len(visible))}{visible}"


def _advisory_lock_key(canonical: str) -> int:
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _identity_lock_keys(data: StudentCreate) -> list[int]:
    """Return ordered locks for every identity dimension used by matching."""

    canonical_dimensions = {
        "|".join(
            (
                "name_birth",
                normalize_search_text(data.full_name),
                data.birth_date.isoformat(),
            )
        ),
    }
    parent_phone = normalize_vietnam_phone(data.parent_phone)
    student_phone = normalize_vietnam_phone(data.student_phone)
    if parent_phone:
        canonical_dimensions.add(f"parent_phone|{parent_phone}")
    if student_phone:
        canonical_dimensions.add(f"student_phone|{student_phone}")
    return sorted(_advisory_lock_key(value) for value in canonical_dimensions)


def _identity_lock_key(data: StudentCreate) -> int:
    """Compatibility helper exposing the primary stable identity lock."""

    return _identity_lock_keys(data)[0]


async def lock_student_identity(db: AsyncSession, data: StudentCreate) -> None:
    """Serialize concurrent create/restore requests for the same identity."""

    for lock_key in _identity_lock_keys(data):
        await db.execute(select(func.pg_advisory_xact_lock(lock_key)))


def _score_candidate(student: Student, data: StudentCreate) -> _ScoredCandidate | None:
    name_matches = normalize_search_text(student.full_name) == normalize_search_text(
        data.full_name
    )
    birth_date_matches = student.birth_date == data.birth_date
    student_phone_matches = bool(
        data.student_phone
        and normalize_vietnam_phone(student.student_phone)
        == normalize_vietnam_phone(data.student_phone)
    )
    parent_phone_matches = normalize_vietnam_phone(
        student.parent_phone
    ) == normalize_vietnam_phone(data.parent_phone)

    if (
        name_matches
        and birth_date_matches
        and (student_phone_matches or parent_phone_matches)
    ):
        return _ScoredCandidate(
            student=student,
            score=100,
            strength="strong",
            reason="Trùng họ tên, ngày sinh và số điện thoại.",
        )
    if student_phone_matches and birth_date_matches:
        return _ScoredCandidate(
            student=student,
            score=95,
            strength="strong",
            reason="Trùng ngày sinh và số điện thoại học viên.",
        )
    if name_matches and birth_date_matches:
        return _ScoredCandidate(
            student=student,
            score=80,
            strength="possible",
            reason="Trùng họ tên và ngày sinh.",
        )
    if name_matches and (student_phone_matches or parent_phone_matches):
        return _ScoredCandidate(
            student=student,
            score=70,
            strength="possible",
            reason="Trùng họ tên và số điện thoại.",
        )
    return None


def _previous_classes(student: Student) -> list[StudentPreviousClass]:
    classes: list[StudentPreviousClass] = []
    seen_class_ids: set[str] = set()
    for enrollment in sorted(
        student.enrollments,
        key=lambda item: (item.created_at is not None, item.created_at, item.id),
        reverse=True,
    ):
        if enrollment.class_ is None or enrollment.class_id in seen_class_ids:
            continue
        seen_class_ids.add(enrollment.class_id)
        classes.append(
            StudentPreviousClass(
                name=enrollment.class_.name,
                enrollment_date=enrollment.enrollment_date,
            )
        )
        if len(classes) == 3:
            break
    return classes


def _already_in_target_class(student: Student, target_class_id: str) -> bool:
    return any(
        enrollment.status == "active"
        and enrollment.class_id == target_class_id
        and enrollment.class_ is not None
        and is_operational_class(enrollment.class_)
        for enrollment in student.enrollments
    )


async def find_student_identity_candidates(
    db: AsyncSession,
    data: StudentCreate,
) -> list[StudentIdentityCandidate]:
    parent_phone = normalize_vietnam_phone(data.parent_phone)
    student_phone = normalize_vietnam_phone(data.student_phone)
    lookup_conditions = [Student.birth_date == data.birth_date]
    if parent_phone:
        lookup_conditions.append(_phone_digits(Student.parent_phone) == parent_phone)
    if student_phone:
        lookup_conditions.append(_phone_digits(Student.student_phone) == student_phone)

    result = await db.execute(
        select(Student)
        .where(or_(*lookup_conditions))
        .options(selectinload(Student.enrollments).selectinload(Enrollment.class_))
        .order_by(Student.updated_at.desc(), Student.id.asc())
        .limit(_CANDIDATE_POOL_LIMIT)
        .with_for_update()
    )
    scored = [
        candidate
        for student in result.scalars().unique().all()
        if (candidate := _score_candidate(student, data)) is not None
    ]
    scored.sort(
        key=lambda candidate: (
            -candidate.score,
            candidate.student.status != "active",
            candidate.student.id,
        )
    )

    target_class_id = str(data.class_id) if data.class_id is not None else None
    return [
        StudentIdentityCandidate(
            id=candidate.student.id,
            status=candidate.student.status,
            full_name=candidate.student.full_name,
            birth_date=candidate.student.birth_date,
            school=candidate.student.school,
            masked_parent_phone=_mask_phone(candidate.student.parent_phone),
            masked_student_phone=_mask_phone(candidate.student.student_phone),
            previous_classes=_previous_classes(candidate.student),
            updated_at=candidate.student.updated_at,
            match_strength=candidate.strength,
            match_reason=candidate.reason,
            already_in_target_class=_already_in_target_class(
                candidate.student,
                target_class_id,
            ),
        )
        for candidate in scored[:_CANDIDATE_RESPONSE_LIMIT]
    ]


def build_student_identity_conflict(
    data: StudentCreate,
    candidates: list[StudentIdentityCandidate],
    *,
    changed: bool = False,
) -> StudentIdentityConflict:
    return StudentIdentityConflict(
        code=(
            "STUDENT_IDENTITY_CONFLICT_CHANGED"
            if changed
            else "STUDENT_IDENTITY_CONFLICT"
        ),
        target_class_id=data.class_id,
        candidates=candidates,
    )
