from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

CheckInStatus = Literal["CHECKED_IN"]


class AttendanceCheckInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID = Field(default_factory=uuid4)


class AttendanceCheckInResponse(BaseModel):
    attendance_id: UUID
    status: CheckInStatus
    checkin_at: datetime
    rate_amount: int
    occurrence_start_at: datetime


class ManualAttendanceCreate(BaseModel):
    """Admin/dev clock in a staff member against a real class session."""

    model_config = ConfigDict(extra="forbid")

    occurrence_id: UUID
    request_id: UUID = Field(default_factory=uuid4)
    reason: str | None = Field(default=None, max_length=500)


class AttendanceReversalCreate(BaseModel):
    """Undo a wrong check-in; the ledger keeps an append-only REVERSAL."""

    model_config = ConfigDict(extra="forbid")

    request_id: UUID = Field(default_factory=uuid4)
    reason: str = Field(min_length=1, max_length=500)


class AttendanceReversalResponse(BaseModel):
    attendance_id: UUID
    reversed_at: datetime
    reason: str


class ManualAttendanceTarget(BaseModel):
    occurrence_id: UUID
    class_name: str
    role: str
    occurrence_start_at: datetime
    occurrence_end_at: datetime
    kind: str
    rate_amount: int | None = None


class AttendanceTodayResponse(BaseModel):
    staff_id: UUID
    occurrences: list[dict]
    checkins: list[dict]
