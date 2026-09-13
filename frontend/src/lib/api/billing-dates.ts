import { z } from "zod";
import { apiClient } from "@/lib/api/client";

const date = z.iso.date();
const interval = z.object({ start: date, end: date });
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const amount = z.number().int().nonnegative();

const pendingReviewSchema = z.object({
  id: z.string().uuid(), change_kind: z.string(), reason: z.string(),
  created_at: z.string(), anchor_date: date,
  fees: z.array(z.object({ id: z.string(), coverage: interval.nullable(), amount })),
});

export const billingScheduleSchema = z.object({
  enrollment_id: z.string().uuid(),
  anchor_date: date.nullable(),
  version: z.number().int().nonnegative(),
  billing_type: z.enum(["MONTHLY", "COURSE"]).nullable(),
  cycle_weeks: z.number().int().positive().nullable(),
  review_pending: z.boolean(),
  current_period: z.string().nullable().optional(),
  current_fee_status: z.enum(["PAID", "UNPAID"]).nullable().optional(),
  next_period: z.string().nullable().optional(),
  next_due_date: date.nullable().optional(),
});

export const billingSchedulePreviewSchema = z.object({
  pending_review: pendingReviewSchema.nullable().optional(),
  can_apply: z.boolean(), preview_fingerprint: fingerprint, current_anchor_date: date,
  replaced_fees: z.array(z.object({ id: z.string(), coverage: interval.nullable(), amount })).default([]),
  plan: z.object({
    enrollment_id: z.string().uuid(), version: z.number().int().nonnegative(), business_date: date,
    anchor: date, billing_type: z.enum(["MONTHLY", "COURSE"]), cycle_weeks: z.number().nullable(),
    first_cycle: z.number().int().nonnegative(), keep_ids: z.array(z.string().uuid()),
    supersede_ids: z.array(z.string().uuid()),
    charges: z.array(z.object({ coverage: interval, due_date: date, amount,
      cycle_no: z.number().int().nonnegative().nullable(), kind: z.enum(["CYCLE", "TRANSITION", "OLD_SCHEDULE_CYCLE"]),
    })),
    waived_intervals: z.array(interval), gap_intervals: z.array(interval),
    retained_waived_intervals: z.array(interval).optional(),
    replaced_waived_intervals: z.array(interval).optional(),
    suspension_adjustment: z.object({ delta_days: z.number().int(), applies_from: date, previous_days: z.number().int(),
      preserved_days: z.number().int(), pending_only: z.boolean() }).nullable().optional(),
    scheduled_segments: z.array(z.object({ coverage: interval, anchor: date,
      billing_type: z.enum(["MONTHLY", "COURSE"]), cycle_weeks: z.number().nullable(), amount,
    })).default([]),
    source_digest: fingerprint, reason: z.string(), policy_version: z.number().int().positive(),
  }),
});

export const historicalCycleItemSchema = z.object({
  cycle_no: z.number().int().nonnegative(),
  coverage_start: date,
  coverage_end: date,
  base_due_date: date,
  amount,
  label: z.string(),
});

export const candidateCycleChoiceSchema = z.object({
  cycle_no: z.number().int(),
  due_date: date,
  coverage_start: date,
  coverage_end: date,
  label: z.string(),
  description: z.string(),
  is_default: z.boolean().default(false),
});

export const billingScheduleOptionItemSchema = z.object({
  id: z.string(),
  strategy: z.enum(["KEEP_CURRENT", "REPLACE_CURRENT", "FROM_CYCLE", "CONTINUE_OLD_UNTIL_NEW", "UNCHANGED"]),
  label: z.string(),
  description: z.string(),
  is_recommended: z.boolean(),
  is_allowed: z.boolean(),
  disabled_reason: z.string().nullable().optional(),
  suggested_first_cycle: z.number().int().nonnegative().nullable().optional(),
  requires_historical_selection: z.boolean().default(false),
  available_historical_cycles: z.array(historicalCycleItemSchema).default([]),
  has_more_historical_cycles: z.boolean().default(false),
  total_historical_cycles_count: z.number().int().nonnegative().default(0),
  historical_offset: z.number().int().nonnegative().default(0),
  historical_limit: z.number().int().positive().default(12),
  next_historical_offset: z.number().int().nonnegative().nullable().optional(),
  requires_gap_policy: z.boolean().default(false),
  estimated_transition_amount: z.number().int().nonnegative().nullable().optional(),
  gap_days: z.number().int().nonnegative().nullable().optional(),
  gap_start: date.nullable().optional(),
  gap_end: date.nullable().optional(),
  actual_cycle_end: date.nullable().optional(),
  new_due_date: date.nullable().optional(),
  old_due_date: date.nullable().optional(),
  next_due_date: date.nullable().optional(),
  is_current_paid: z.boolean().default(false),
  candidate_cycles: z.array(candidateCycleChoiceSchema).default([]),
});

export const billingScheduleOptionsResponseSchema = z.object({
  replaceable_waived_intervals: z.array(interval).optional(),
  pending_review: pendingReviewSchema.nullable().optional(),
  business_date: date,
  classification: z.object({
    time_direction: z.enum(["PAST", "TODAY", "FUTURE"]),
    distance: z.enum(["NEAR", "FAR", "EXACT", "UNCHANGED"]),
    anchor_relative: z.enum(["EARLIER", "LATER", "UNCHANGED"]),
    case_code: z.enum(["UNCHANGED", "UNSTARTED", "ACTIVE_NO_FEES", "NEAR_PAST", "FAR_PAST", "TODAY", "NEAR_FUTURE", "FAR_FUTURE", "BLOCKED"]),
    summary: z.string(),
  }),
  current_anchor_date: date.nullable(),
  new_anchor_date: date,
  expected_version: z.number().int().nonnegative(),
  cycle_info: z.object({
    current_cycle_no: z.number().int(),
    current_cycle_start: date,
    current_cycle_end: date,
    prev_cycle_start: date.nullable().optional(),
    prev_cycle_end: date.nullable().optional(),
    next_cycle_start: date.nullable().optional(),
    next_cycle_end: date.nullable().optional(),
    billing_type: z.string(),
    cycle_weeks: z.number().nullable().optional(),
  }).nullable(),
  financial_state: z.object({
    has_protected_fees: z.boolean(),
    protected_through: date.nullable(),
    protected_count: z.number().int().nonnegative(),
    mutable_count: z.number().int().nonnegative(),
    unpaid_notified_count: z.number().int().nonnegative(),
    active_fees_count: z.number().int().nonnegative(),
  }),
  options: z.array(billingScheduleOptionItemSchema),
  recommended_option_id: z.string().nullable().optional(),
  is_blocked: z.boolean(),
  blocked_reason: z.string().nullable().optional(),
  context_token: z.string(),
});

export const feeDeadlinePreviewSchema = z.object({
  fee_record_id: z.string().uuid(), previous_due_date: date, next_due_date: date, amount,
  coverage_start: date.nullable(), coverage_end: date.nullable(), schedule_unchanged: z.literal(true),
  already_notified: z.boolean(), becomes_overdue: z.boolean(), preview_fingerprint: fingerprint,
});

export type BillingSchedule = z.infer<typeof billingScheduleSchema>;
export type BillingSchedulePreview = z.infer<typeof billingSchedulePreviewSchema>;
export type HistoricalCycleItem = z.infer<typeof historicalCycleItemSchema>;
export type CandidateCycleChoice = z.infer<typeof candidateCycleChoiceSchema>;
export type BillingScheduleOptionItem = z.infer<typeof billingScheduleOptionItemSchema>;
export type BillingScheduleOptionsResponse = z.infer<typeof billingScheduleOptionsResponseSchema>;
export type BillingScheduleOptionsRequest = {
  replace_future_waivers?: boolean;
  anchor_date: string;
  expected_version: number;
  historical_offset?: number;
  historical_limit?: number;
  historical_from_date?: string;
  historical_to_date?: string;
};
export type FeeDeadlinePreview = z.infer<typeof feeDeadlinePreviewSchema>;
export type BillingScheduleDraft = {
  replace_future_waivers?: boolean;
  anchor_date: string; expected_version: number;
  strategy: "KEEP_CURRENT" | "REPLACE_CURRENT" | "FROM_CYCLE" | "CONTINUE_OLD_UNTIL_NEW" | "UNCHANGED";
  first_cycle?: number; apply_from_date?: string; historical_cycles?: number[];
  gap_policy: "REVIEW" | "CHARGE" | "WAIVE"; reason: string;
  custom_transition_amount?: number | null;
  expected_context_token?: string;
  expected_pending_review_id?: string;
};
export type FeeDeadlineDraft = { due_date: string; reason: string };
export type AcceptedPreview = { request_id: string; expected_preview_fingerprint: string };

export async function getDateCapabilities(signal?: AbortSignal) {
  const { data } = await apiClient.get<unknown>("/students/date-capabilities", { signal });
  return z.object({ independent_billing_dates: z.boolean() }).parse(data);
}

export async function getBillingSchedule(id: string, signal?: AbortSignal) {
  const { data } = await apiClient.get<unknown>(`/enrollments/${id}/billing-schedule/summary`, { signal, timeout: 60_000 });
  return billingScheduleSchema.parse(data);
}

export async function analyzeBillingScheduleOptions(
  id: string,
  payload: BillingScheduleOptionsRequest,
  signal?: AbortSignal
) {
  const { data } = await apiClient.post<unknown>(
    `/enrollments/${id}/billing-schedule/options`,
    payload,
    { signal, timeout: 60_000 }
  );
  return billingScheduleOptionsResponseSchema.parse(data);
}

export async function previewBillingSchedule(id: string, draft: BillingScheduleDraft, signal?: AbortSignal) {
  const { data } = await apiClient.post<unknown>(`/enrollments/${id}/billing-schedule/preview`, draft, { signal, timeout: 60_000 });
  return billingSchedulePreviewSchema.parse(data);
}

export async function applyBillingSchedule(id: string, command: BillingScheduleDraft & AcceptedPreview) {
  const { data } = await apiClient.post<unknown>(`/enrollments/${id}/billing-schedule/apply`, command, { timeout: 60_000 });
  return billingSchedulePreviewSchema.parse(data);
}

export async function previewFeeDeadline(id: string, draft: FeeDeadlineDraft, signal?: AbortSignal) {
  const { data } = await apiClient.post<unknown>(`/fees/${id}/due-date/preview`, draft, { signal });
  return feeDeadlinePreviewSchema.parse(data);
}

export async function applyFeeDeadline(id: string, command: FeeDeadlineDraft & AcceptedPreview) {
  const { data } = await apiClient.post<unknown>(`/fees/${id}/due-date/apply`, command);
  return feeDeadlinePreviewSchema.parse(data);
}
