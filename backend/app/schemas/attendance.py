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


class AttendanceTodayResponse(BaseModel):
    staff_id: UUID
    occurrences: list[dict]
    checkins: list[dict]
