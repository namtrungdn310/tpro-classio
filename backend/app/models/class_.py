from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class Class(WorkspaceScoped, Base):
    __tablename__ = "classes"
    __table_args__ = (
        CheckConstraint(
            "billing_cycle_months >= 1", name="classes_billing_cycle_months_check"
        ),
        CheckConstraint(
            "billing_cycle_weeks is null or billing_cycle_weeks between 1 and 260",
            name="classes_billing_cycle_weeks_check",
        ),
        CheckConstraint(
            "char_length(btrim(name)) between 1 and 120",
            name="classes_name_length_check",
        ),
        CheckConstraint(
            "base_fee >= 0 and base_fee <= 999999999999",
            name="classes_base_fee_range_check",
        ),
        CheckConstraint(
            "(type = 'MONTHLY' and billing_cycle_months = 1 and billing_cycle_weeks is null) or "
            "(type = 'COURSE' and billing_cycle_weeks >= 1)",
            name="classes_type_billing_cycle_check",
        ),
        CheckConstraint(
            "start_date is null or end_date is null or end_date >= start_date",
            name="classes_date_range_check",
        ),
        CheckConstraint(
            "(stopped_on is null and stopped_at is null and stopped_reason is null) or "
            "(stopped_on is not null and stopped_at is not null and "
            "char_length(btrim(stopped_reason)) between 3 and 500)",
            name="classes_stopped_shape_check",
        ),
        UniqueConstraint(
            "workspace_id",
            "id",
            name="classes_workspace_id_id_unique",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "previous_class_id"],
            ["classes.workspace_id", "classes.id"],
            name="classes_previous_class_workspace_fkey",
            ondelete="RESTRICT",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(
        ENUM("MONTHLY", "COURSE", name="class_type", create_type=False),
        nullable=False,
    )
    base_fee: Mapped[Decimal] = mapped_column(Numeric(12, 0), nullable=False, default=0)
    billing_cycle_months: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
    )
    billing_cycle_weeks: Mapped[int | None] = mapped_column(SmallInteger)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    identity_scheme: Mapped[str] = mapped_column(
        ENUM(
            "LEGACY",
            "ACADEMIC_YEAR",
            "INTAKE",
            name="class_identity_scheme",
            create_type=False,
        ),
        nullable=False,
        default="LEGACY",
    )
    class_category: Mapped[str | None] = mapped_column(
        ENUM(
            "GENERAL",
            "SPECIALIZED",
            "IELTS",
            "CUSTOM",
            name="class_category",
            create_type=False,
        )
    )
    grade_mode: Mapped[str | None] = mapped_column(
        ENUM("GRADE", "NONE", name="class_grade_mode", create_type=False)
    )
    program_name: Mapped[str | None] = mapped_column(Text)
    grade_level: Mapped[int | None] = mapped_column(SmallInteger)
    education_level: Mapped[str | None] = mapped_column(Text)
    academic_year_start: Mapped[int | None] = mapped_column(SmallInteger)
    # PostgreSQL derives this value from start_date. Declaring the generated
    # column here keeps SQLAlchemy from including it in INSERT/UPDATE payloads.
    intake_year_month: Mapped[int | None] = mapped_column(
        Integer,
        Computed(
            "case when start_date is null then null "
            "else (extract(year from start_date)::integer * 100) + "
            "extract(month from start_date)::integer end",
            persisted=True,
        ),
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_reason: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Open-ended lifecycle: a class remains operational until management stops
    # it.  Keep the business date separate from the audit timestamp so the
    # result is stable across UTC/local-time boundaries.
    stopped_on: Mapped[date | None] = mapped_column(Date)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stopped_reason: Mapped[str | None] = mapped_column(Text)
    previous_class_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
    )
    continuation_request_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    schedule: Mapped[dict | None] = mapped_column(JSONB)
    teacher_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("staff_members.id", ondelete="SET NULL"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(nullable=False, default=1)

    enrollments = relationship("Enrollment", back_populates="class_", lazy="selectin")
    billing_cycle_revisions = relationship(
        "ClassBillingCycleRevision", back_populates="class_", lazy="selectin"
    )
    teacher = relationship("StaffMember", back_populates="classes", lazy="selectin")
    teacher_links = relationship(
        "ClassTeacher",
        back_populates="class_",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    teachers = relationship(
        "StaffMember",
        secondary="class_teachers",
        viewonly=True,
        lazy="selectin",
    )
    schedule_adjustments = relationship(
        "ClassScheduleAdjustment",
        back_populates="class_",
        lazy="selectin",
    )
    session_exceptions = relationship(
        "ClassSessionException",
        back_populates="class_",
        lazy="selectin",
    )
    schedule_slots = relationship(
        "ClassScheduleSlot",
        back_populates="class_",
        lazy="selectin",
    )
