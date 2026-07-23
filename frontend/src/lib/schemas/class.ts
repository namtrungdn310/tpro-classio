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
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  schedule: classScheduleSchema,
  teacher_id: z.string().uuid().nullable(),
  teacher_ids: z.array(z.string().uuid()).default([]),
  teacher_name: z.string().nullable(),
  teacher_names: z.array(z.string()).default([]),
  is_active: z.boolean(),
  student_count: z.number().int().min(0),
  created_at: z.string(),
});

export const classResponseListSchema = z.array(classResponseSchema);
