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
  status: z.enum(["active", "dropped"]),
  enrollment_date: nullableDateSchema,
  class_name: z.string().min(1).max(120),
  effective_fee: moneySchema,
});

const studentEnrollmentInfoSchema = z.object({
  id: z.string().uuid(),
  class_id: z.string().uuid(),
  class_name: z.string().min(1).max(120),
  custom_fee: moneySchema.nullable(),
  effective_fee: moneySchema,
  enrollment_date: nullableDateSchema,
  status: z.enum(["active", "dropped"]),
});

export const studentResponseSchema = z.object({
  id: z.string().uuid(),
  // Response validation protects the transport shape, not write-time business
  // limits. Legacy rows can predate the current form constraints and must not
  // make the whole students page fail to render.
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
  status: z.enum(["active", "inactive"]),
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

export const contactSuggestionResponseSchema = z
  .object({
    phone: z.string().min(1).max(32),
    zalo_name: z.string().min(1).max(100),
  })
  .nullable();
