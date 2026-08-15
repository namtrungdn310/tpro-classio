import { z } from "zod";

const classDaySchema = z.enum([
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ Nhật",
]);

const classScheduleSlotSchema = z.object({
  day: classDaySchema,
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  teacher_ids: z.array(z.string().uuid()).optional(),
  assistant_ids: z.array(z.string().uuid()).optional(),
  // The backend read projection serializes relational slot metadata as null
  // for legacy JSON-only schedules. Normalize that wire representation to
  // undefined so the rest of the frontend keeps one canonical "not present"
  // shape instead of failing the entire class/history response.
  id: z
    .string()
    .uuid()
    .nullish()
    .transform((value) => value ?? undefined),
  version: z
    .number()
    .int()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
});

const classScheduleSchema = z
  .object({
    text: z.string().optional(),
    slots: z.array(classScheduleSlotSchema).optional(),
  })
  .nullable();

export const classResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  type: z.enum(["MONTHLY", "COURSE"]),
  base_fee: z.number().int().min(0).max(999_999_999_999),
  billing_cycle_months: z.number().int().min(1).max(24),
  billing_cycle_weeks: z.number().int().min(1).max(32_767).nullable().default(null),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  identity_scheme: z.enum(["LEGACY", "ACADEMIC_YEAR", "INTAKE"]),
  class_category: z.enum(["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]).nullable(),
  grade_mode: z.enum(["GRADE", "NONE"]).nullable(),
  program_name: z.string().min(1).max(120).nullable(),
  grade_level: z.number().int().min(1).max(12).nullable(),
  education_level: z.enum(["PRIMARY", "MIDDLE", "HIGH"]).nullable(),
  academic_year_start: z.number().int().min(2000).max(2200).nullable(),
  schedule: classScheduleSchema,
  teacher_id: z.string().uuid().nullable(),
  teacher_ids: z.array(z.string().uuid()).default([]),
  teacher_name: z.string().nullable(),
  teacher_names: z.array(z.string()).default([]),
  assistant_ids: z.array(z.string().uuid()).default([]),
  assistant_names: z.array(z.string()).default([]),
  is_active: z.boolean(),
  student_count: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().min(1),
  display_name: z.string().min(1).max(260),
  primary_label: z.string().min(1).max(240),
  secondary_label: z.string().max(160).nullable(),
  effective_status: z.enum(["LEGACY", "SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"]),
  can_edit_end_date: z.boolean(),
  can_edit: z.boolean().default(false),
  can_cancel: z.boolean().default(false),
  can_view_history: z.boolean().default(true),
  next_fee_due_date: z.string().nullable().default(null),
  next_fee_due_state: z.enum(["OVERDUE", "UPCOMING", "NONE"]).default("NONE"),
  cancelled_at: z.string().nullable().default(null),
  unresolved_makeup_count: z.number().int().min(0).default(0),
});

export const classResponseListSchema = z.array(classResponseSchema);

export const classScopeSummarySchema = z.object({
  operational: z.number().int().min(0),
  active: z.number().int().min(0),
  scheduled: z.number().int().min(0),
  completed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
});

export const classScheduleAvailabilityConflictSchema = z.object({
  class_id: z.string().uuid(),
  class_name: z.string().min(1),
  class_category: z.enum(["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]).nullable(),
  grade_level: z.number().int().min(1).max(12).nullable(),
  day: z.enum(["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]),
  start: z.string(),
  end: z.string(),
  busy_teacher_ids: z.array(z.string().uuid()),
  busy_assistant_ids: z.array(z.string().uuid()),
});

export const classScheduleAvailabilityResponseSchema = z.object({
  conflicts: z.array(classScheduleAvailabilityConflictSchema),
});

export const classEndDatePreviewSchema = z.object({
  previous_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  next_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_weeks: z.number().int().min(1).nullable(),
  package_count: z.number().int().min(1).nullable(),
  affected_student_count: z.number().int().min(0),
  mutable_fee_record_count: z.number().int().min(0),
  protected_fee_record_count: z.number().int().min(0),
  version: z.number().int().min(1),
  preview_fingerprint: z.string().min(32).max(64),
  preview_expires_at: z.string(),
});

export const classHistorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  display_name: z.string().min(1),
  primary_label: z.string().min(1),
  secondary_label: z.string().nullable(),
  effective_status: z.enum(["LEGACY", "SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"]),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  schedule: classScheduleSchema,
  teachers: z.array(
    z.object({
      teacher_id: z.string().uuid(),
      teacher_name: z.string().min(1),
      staff_type: z.enum(["TEACHER", "ASSISTANT"]),
      event_type: z.enum(["assigned", "unassigned"]),
      occurred_at: z.string(),
    }),
  ),
  enrollments: z.array(
    z.object({
      enrollment_id: z.string().uuid(),
      student_id: z.string().uuid(),
      student_name: z.string().min(1),
      enrollment_date: z.string().nullable(),
      ended_at: z.string().nullable(),
      status: z.enum(["active", "dropped", "completed", "cancelled"]),
    }),
  ),
  lifecycle_events: z.array(
    z.object({
      event_type: z.string(),
      previous_end_date: z.string().nullable(),
      next_end_date: z.string().nullable(),
      reason: z.string().nullable(),
      occurred_at: z.string(),
    }),
  ),
  adjustments: z.array(
    z.object({
      adjustment_id: z.string().uuid(),
      reason_code: z.enum(["TEACHER_UNAVAILABLE", "CENTER_OPERATION", "OTHER"]),
      reason_note: z.string().nullable(),
      original_start_at: z.string(),
      original_end_at: z.string(),
      status: z.enum([
        "MAKEUP_PENDING",
        "MAKEUP_SCHEDULED",
        "MAKEUP_COMPLETED",
        "RESTORED",
        "CANCELLED",
      ]),
      display_status: z.enum([
        "MAKEUP_PENDING",
        "MAKEUP_SCHEDULED",
        "AWAITING_CONFIRMATION",
        "MAKEUP_COMPLETED",
        "RESTORED",
        "CANCELLED",
      ]),
      replacement_start_at: z.string().nullable(),
      replacement_end_at: z.string().nullable(),
      completed_at: z.string().nullable(),
      restored_at: z.string().nullable(),
      version: z.number().int().min(1),
    }),
  ),
});

export const classOccurrenceSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["REGULAR", "POSTPONED", "MAKEUP"]),
  original_start_at: z.string(),
  original_end_at: z.string(),
  source_slot_key: z.string(),
  teacher_ids: z.array(z.string().uuid()).default([]),
  assistant_ids: z.array(z.string().uuid()).default([]),
  exception_id: z.string().uuid().nullable(),
  status: z
    .enum([
      "MAKEUP_PENDING",
      "MAKEUP_SCHEDULED",
      "AWAITING_CONFIRMATION",
      "MAKEUP_COMPLETED",
      "RESTORED",
      "CANCELLED",
    ])
    .nullable(),
  replacement_start_at: z.string().nullable(),
  replacement_end_at: z.string().nullable(),
  adjustable: z.boolean(),
  already_adjusted: z.boolean(),
  passed: z.boolean(),
});

export const classOccurrenceListSchema = z.object({
  class_id: z.string().uuid(),
  occurrences: z.array(classOccurrenceSchema).default([]),
});

export const classSessionExceptionSchema = z.object({
  id: z.string().uuid(),
  adjustment_id: z.string().uuid(),
  class_id: z.string().uuid(),
  original_start_at: z.string(),
  original_end_at: z.string(),
  original_timezone: z.string(),
  status: z.enum([
    "MAKEUP_PENDING",
    "MAKEUP_SCHEDULED",
    "MAKEUP_COMPLETED",
    "RESTORED",
    "CANCELLED",
  ]),
  display_status: z.enum([
    "MAKEUP_PENDING",
    "MAKEUP_SCHEDULED",
    "AWAITING_CONFIRMATION",
    "MAKEUP_COMPLETED",
    "RESTORED",
    "CANCELLED",
  ]),
  replacement_start_at: z.string().nullable(),
  replacement_end_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  restored_at: z.string().nullable(),
  version: z.number().int().min(1),
  staff: z.array(
    z.object({
      staff_id: z.string().uuid(),
      role: z.enum(["TEACHER", "ASSISTANT"]),
      display_name: z.string().min(1),
      source_slot_key: z.string(),
    }),
  ),
  eligible_student_count: z.number().int().min(0),
  billing_impact: z.literal("NONE"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const classAdjustmentListSchema = z.object({
  adjustments: z.array(
    z.object({
      id: z.string().uuid(),
      class_id: z.string().uuid(),
      reason_code: z.enum(["TEACHER_UNAVAILABLE", "CENTER_OPERATION", "OTHER"]),
      reason_note: z.string().nullable(),
      affected_from: z.string(),
      affected_through: z.string(),
      status: z.enum(["OPEN", "CLOSED"]),
      created_by: z.string().uuid(),
      request_id: z.string().uuid(),
      version: z.number().int().min(1),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
  exceptions: z.array(classSessionExceptionSchema).default([]),
});

export const postponementPreviewSchema = z.object({
  class_id: z.string().uuid(),
  occurrences: z.array(
    z.object({
      key: z.string().min(1),
      original_start_at: z.string(),
      original_end_at: z.string(),
      source_slot_key: z.string(),
      teacher_ids: z.array(z.string().uuid()).default([]),
      assistant_ids: z.array(z.string().uuid()).default([]),
      adjustable: z.boolean(),
      already_adjusted: z.boolean(),
      passed: z.boolean(),
    }),
  ),
  billing_impact: z.literal("NONE"),
});

export const postponementCreateSchema = z.object({
  adjustment: z.object({
    id: z.string().uuid(),
    class_id: z.string().uuid(),
    reason_code: z.enum(["TEACHER_UNAVAILABLE", "CENTER_OPERATION", "OTHER"]),
    reason_note: z.string().nullable(),
    affected_from: z.string(),
    affected_through: z.string(),
    status: z.enum(["OPEN", "CLOSED"]),
    created_by: z.string().uuid(),
    request_id: z.string().uuid(),
    version: z.number().int().min(1),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  exceptions: z.array(classSessionExceptionSchema),
  billing_impact: z.literal("NONE"),
});

export const makeupSchedulePreviewSchema = z.object({
  exception_id: z.string().uuid(),
  original_start_at: z.string(),
  original_end_at: z.string(),
  duration_minutes: z.number().int().min(1),
  replacement_start_at: z.string(),
  replacement_end_at: z.string(),
  staff: z.array(
    z.object({
      staff_id: z.string().uuid(),
      role: z.enum(["TEACHER", "ASSISTANT"]),
      display_name: z.string().min(1),
      source_slot_key: z.string(),
    }),
  ),
  eligible_student_count: z.number().int().min(0),
  conflicts: z.array(
    z.object({
      code: z.enum([
        "CLASS_VERSION_CONFLICT",
        "OCCURRENCE_NOT_FOUND",
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
      ]),
      message: z.string(),
      class_id: z.string().uuid().nullable(),
      class_name: z.string().nullable(),
      staff_ids: z.array(z.string().uuid()).default([]),
      day: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
    }),
  ),
  staff_inactive: z.array(
    z.object({
      staff_id: z.string().uuid(),
      role: z.enum(["TEACHER", "ASSISTANT"]),
      display_name: z.string().min(1),
      source_slot_key: z.string(),
    }),
  ),
  can_schedule: z.boolean(),
  billing_impact: z.literal("NONE"),
});

export const exceptionCommandSchema = z.object({
  exception: classSessionExceptionSchema,
  effective_status: z.enum([
    "LEGACY",
    "SCHEDULED",
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
  ]),
  billing_impact: z.literal("NONE"),
});
