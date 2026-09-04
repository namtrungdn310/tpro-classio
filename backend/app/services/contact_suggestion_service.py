from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.class_lifecycle import operational_class_predicate
from app.core.enrollment_lifecycle import enrollment_current_or_scheduled_predicate
from app.models.enrollment import Enrollment
from app.models.staff import StaffMember
from app.models.student import Student
from app.schemas.contact_suggestion import (
    ContactSuggestionLookup,
    ContactSuggestionResponse,
)


async def lookup_contact_suggestion(
    db: AsyncSession,
    lookup: ContactSuggestionLookup,
) -> ContactSuggestionResponse | None:
    """Return one unambiguous contact pair from the current workspace.

    The lookup is intentionally read-through: there is no secondary contact
    store or persistent autocomplete cache to retain personal data after its
    source stops being eligible.
    """

    if lookup.owner == "staff":
        phone_column = StaffMember.phone
        zalo_column = StaffMember.zalo_name
        # Retained staff profiles remain useful when a former staff member is
        # re-entered. The unique-match rule below still prevents an ambiguous
        # Zalo name or phone number from being filled automatically.
        source_constraints = ()
    else:
        phone_column = (
            Student.student_phone if lookup.owner == "student" else Student.parent_phone
        )
        zalo_column = (
            Student.student_zalo if lookup.owner == "student" else Student.parent_zalo
        )
        hidden_field = f"{lookup.owner}_contact"
        has_current_class = Student.enrollments.any(
            and_(
                enrollment_current_or_scheduled_predicate(),
                Enrollment.class_.has(operational_class_predicate()),
            )
        )
        source_constraints = (
            Student.status == "active",
            has_current_class,
            ~Student.hidden_fields.contains([hidden_field]),
        )

    lookup_condition = (
        func.regexp_replace(func.coalesce(phone_column, ""), r"\D", "", "g")
        == lookup.phone
        if lookup.phone is not None
        else func.lower(func.btrim(func.coalesce(zalo_column, "")))
        == lookup.zalo_name.lower()
    )

    result = await db.execute(
        select(
            phone_column.label("phone"),
            zalo_column.label("zalo_name"),
        )
        .distinct()
        .where(
            lookup_condition,
            phone_column.is_not(None),
            func.btrim(phone_column) != "",
            zalo_column.is_not(None),
            func.btrim(zalo_column) != "",
            *source_constraints,
        )
        .limit(2),
    )
    rows = result.all()
    if len(rows) != 1:
        return None

    row = rows[0]
    if row.phone is None or row.zalo_name is None:
        return None

    return ContactSuggestionResponse(
        phone=row.phone,
        zalo_name=row.zalo_name,
    )
