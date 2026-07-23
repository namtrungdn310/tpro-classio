from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

EnrollmentStatus = Literal["active", "dropped"]


class EnrollmentCreate(BaseModel):
    student_id: UUID
    class_id: UUID
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None


class EnrollmentUpdate(BaseModel):
    custom_fee: int | None = Field(default=None, ge=0, le=999_999_999_999)
    enrollment_date: date | None = None


class EnrollmentResponse(BaseModel):
    id: UUID
    student_id: UUID
    class_id: UUID
    custom_fee: int | None
    status: EnrollmentStatus
    enrollment_date: date | None
    class_name: str
    effective_fee: int
