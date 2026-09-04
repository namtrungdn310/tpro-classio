from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class Enrollment(WorkspaceScoped, Base):
    __tablename__ = "enrollments"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    student_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_date: Mapped[date | None] = mapped_column(Date)
    # Exclusive business boundary. This is the end of one student's class
    # membership, not a planned class end date.
    ended_on: Mapped[date | None] = mapped_column(Date)
    current_billing_revision_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("billing_anchor_revisions.id", ondelete="RESTRICT"),
    )
    billing_anchor_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    custom_fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 0))
    status: Mapped[str] = mapped_column(
        ENUM(
            "active",
            "dropped",
            "completed",
            "cancelled",
            name="enrollment_status",
            create_type=False,
        ),
        nullable=False,
        default="active",
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    student = relationship("Student", back_populates="enrollments")
    class_ = relationship("Class", back_populates="enrollments")
    fee_records = relationship(
        "FeeRecord",
        back_populates="enrollment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    current_billing_revision = relationship(
        "BillingAnchorRevision",
        foreign_keys=[current_billing_revision_id],
        post_update=True,
    )
    billing_anchor_revisions = relationship(
        "BillingAnchorRevision",
        foreign_keys="BillingAnchorRevision.enrollment_id",
        back_populates="enrollment",
    )
    slot_selections = relationship(
        "EnrollmentSlotSelection",
        back_populates="enrollment",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )
