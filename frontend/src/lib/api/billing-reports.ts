import { z } from "zod";
import { apiClient } from "./client";

const enrollmentSchema = z.object({ id: z.string().uuid(), student_name: z.string(), class_name: z.string(), enrollment_date: z.string().nullable(), status: z.string() });
const pageSchema = z.object({ total: z.number(), page: z.number(), has_next: z.boolean() });
const interval = z.object({ start: z.string(), end: z.string() });
const historySchema = pageSchema.extend({ current_year: z.number(), available_years: z.array(z.number()), items: z.array(z.object({
  id: z.string().uuid(), old_date: z.string(), new_date: z.string(), reason: z.string(), created_at: z.string(), actor_name: z.string().nullable(),
  created_count: z.number(), replaced_count: z.number(), kept_count: z.number(),
  charges: z.array(z.object({ coverage: interval, due_date: z.string(), amount: z.number() })), waived_intervals: z.array(interval),
})) });
export async function getBillingReportEnrollments(q: string, page: number, signal?: AbortSignal) {
  const { data } = await apiClient.get<unknown>("/reports/billing/enrollments", { params: { q, page }, signal });
  return pageSchema.extend({ items: z.array(enrollmentSchema) }).parse(data);
}
export async function getBillingReportHistory(id: string, year: string, page: number, signal?: AbortSignal) {
  const { data } = await apiClient.get<unknown>(`/reports/billing/enrollments/${id}/history`, { params: { year: year === "current" ? undefined : Number(year), page }, signal });
  return historySchema.parse(data);
}

const date = z.iso.date();
const amount = z.number().int().nonnegative();
const billingFeesSchema = z.array(z.object({
    id: z.string().uuid(), due_date: date.nullable(), coverage_start: date.nullable(),
    coverage_end: date.nullable(), amount, status: z.string(), protected: z.boolean(),
    paid_amount: amount.default(0), refunded_amount: amount.default(0),
  }));

export const billingFeePageSchema = z.object({
  items: billingFeesSchema, total: z.number().int().nonnegative(),
  page: z.number().int().positive(), page_size: z.number().int().positive(), has_next: z.boolean(),
  year: z.number().int().nullable(), current_year: z.number().int(), available_years: z.array(z.number().int()),
  older_pending_count: z.number().int().nonnegative(), undated_pending_count: z.number().int().nonnegative(),
});
export type BillingFeePage = z.infer<typeof billingFeePageSchema>;
export type BillingFeeFilters = {
  year: string; state: "ALL" | "PENDING" | "PAID" | "REFUNDED";
  includeInactive: boolean; order: "asc" | "desc"; page: number;
};
export async function getBillingFeePage(id: string, filters: BillingFeeFilters, signal?: AbortSignal) {
  const { data } = await apiClient.get<unknown>(`/reports/billing/enrollments/${id}/fees`, {
    signal, params: { year: filters.year === "current" ? undefined : Number(filters.year), state: filters.state,
      include_inactive: filters.includeInactive, order: filters.order, page: filters.page, page_size: 20 },
  });
  return billingFeePageSchema.parse(data);
}
