import { z } from "zod";

const dashboardPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const dashboardOverviewSchema = z.object({
  summary: z.object({
    period: dashboardPeriodSchema,
    active_student_count: z.number().int().nonnegative(),
    active_class_count: z.number().int().nonnegative(),
    weekly_session_count: z.number().int().nonnegative(),
    active_teacher_count: z.number().int().nonnegative(),
    active_assistant_count: z.number().int().nonnegative(),
  }),
  fees: z.object({
    total_amount: z.number().int().nonnegative(),
    gross_collected_amount: z.number().int().nonnegative(),
    refunded_amount: z.number().int().nonnegative(),
    net_collected_amount: z.number().int().nonnegative(),
    outstanding_amount: z.number().int().nonnegative(),
    paid_record_count: z.number().int().nonnegative(),
    record_count: z.number().int().nonnegative(),
  }),
  revenue_trend: z
    .array(
      z.object({
        period: dashboardPeriodSchema,
        net_collected_amount: z.number().int(),
      }),
    )
    .length(6),
});
