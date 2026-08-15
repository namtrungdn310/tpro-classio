import { z } from "zod";

const dateSchema = z.iso.date();
const nullableDateSchema = dateSchema.nullable();
const moneySchema = z.number().int().min(0).max(999_999_999_999);

const studentHiddenFieldSchema = z.enum([
  "birth_date",
  "school",
  "enrollment_date",
  "custom_fee",
  "student_contact",
  "parent_contact",
  "notes",
]);

export const enrollmentResponseSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  class_id: z.string().uuid(),
  custom_fee: moneySchema.nullable(),
  status: z.enum(["active", "dropped", "completed", "cancelled"]),
  enrollment_date: nullableDateSchema,
  class_name: z.string().min(1).max(120),
  class_category: z.enum(["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]).nullable().default(null),
  class_grade_mode: z.enum(["GRADE", "NONE"]).nullable().default(null),
  class_grade_level: z.number().int().min(1).max(12).nullable().default(null),
  class_start_date: nullableDateSchema.default(null),
  class_end_date: nullableDateSchema.default(null),
  effective_fee: moneySchema,
});

const studentEnrollmentInfoSchema = z.object({
  id: z.string().uuid(),
  class_id: z.string().uuid(),
  class_name: z.string().min(1).max(120),
  class_category: z.enum(["GENERAL", "SPECIALIZED", "IELTS", "CUSTOM"]).nullable().default(null),
  class_grade_mode: z.enum(["GRADE", "NONE"]).nullable().default(null),
  class_grade_level: z.number().int().min(1).max(12).nullable().default(null),
  class_start_date: nullableDateSchema.default(null),
  class_end_date: nullableDateSchema.default(null),
  custom_fee: moneySchema.nullable(),
  effective_fee: moneySchema,
  enrollment_date: nullableDateSchema,
  status: z.enum(["active", "dropped", "completed", "cancelled"]),
});

export const studentResponseSchema = z.object({
  id: z.string().uuid(),
  // Response validation protects the transport shape, not write-time business
  // limits. Legacy rows can predate the current form constraints and must not
  // make the whole students page fail to render.
  student_code: z.string().nullable().optional(),
  full_name: z.string(),
  birth_date: nullableDateSchema,
  school: z.string().nullable(),
  parent_name: z.string().nullable(),
  parent_phone: z.string().nullable(),
  parent_zalo: z.string().nullable(),
  student_zalo: z.string().nullable(),
  student_phone: z.string().nullable(),
  notes: z.string().nullable(),
  hidden_fields: z.array(studentHiddenFieldSchema).max(7),
  status: z.enum(["active", "inactive", "archived"]),
  list_state: z.enum(["UNASSIGNED", "CURRENT", "FORMER", "ARCHIVED"]).default("UNASSIGNED"),
  archived_at: z.string().datetime({ offset: true }).nullable().default(null),
  archived_reason: z.string().nullable().default(null),
  classes: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(120),
    }),
  ),
  active_enrollments: z.array(studentEnrollmentInfoSchema),
  created_at: z.string().datetime({ offset: true }),
});

export const studentResponseListSchema = z.array(studentResponseSchema);

export const studentIdentityCandidateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "inactive"]),
  full_name: z.string().min(1),
  birth_date: nullableDateSchema,
  school: z.string().nullable(),
  masked_parent_phone: z.string().nullable(),
  masked_student_phone: z.string().nullable(),
  previous_classes: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        enrollment_date: nullableDateSchema,
      }),
    )
    .max(3),
  updated_at: z.string().datetime({ offset: true }),
  match_strength: z.enum(["strong", "possible"]),
  match_reason: z.string().min(1),
  already_in_target_class: z.boolean(),
});

export const studentIdentityConflictSchema = z.object({
  code: z.enum([
    "STUDENT_IDENTITY_CONFLICT",
    "STUDENT_IDENTITY_CONFLICT_CHANGED",
  ]),
  message: z.string().min(1),
  target_class_id: z.string().uuid().nullable().optional(),
  candidates: z.array(studentIdentityCandidateSchema).min(1).max(5),
});
