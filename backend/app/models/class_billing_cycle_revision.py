from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, SmallInteger, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.workspace import WorkspaceScoped


class ClassBillingCycleRevision(WorkspaceScoped, Base):
    """Append-only audit batch for one package-duration change on a class."""

    __tablename__ = "class_billing_cycle_revisions"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "request_id",
            name="class_billing_cycle_revisions_request_unique",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    previous_weeks: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    next_weeks: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    effective_policy: Mapped[str] = mapped_column(
        Text, nullable=False, default="NEXT_PACKAGE_BOUNDARY"
    )
    state: Mapped[str] = mapped_column(Text, nullable=False, default="PENDING")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    class_version_before: Mapped[int] = mapped_column(Integer, nullable=False)
    class_version_after: Mapped[int] = mapped_column(Integer, nullable=False)
    affected_enrollment_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    superseded_fee_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    protected_fee_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    revoked_payment_request_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    effective_on: Mapped[date] = mapped_column(Date, nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    resolved_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profiles.id", ondelete="SET NULL"),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    class_ = relationship("Class", back_populates="billing_cycle_revisions")
    enrollment_revisions = relationship(
        "BillingAnchorRevision", back_populates="class_billing_cycle_revision"
    )
