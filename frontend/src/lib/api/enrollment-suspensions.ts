import { z } from "zod";
import { apiClient } from "./client";

export const suspensionDraftSchema = z.object({
  suspension_id: z.uuid().nullable(), action: z.enum(["SAVE", "CANCEL"]),
  suspended_from: z.iso.date(), resume_on: z.iso.date(), reason: z.string().trim().max(500),
});
export const suspensionCommandSchema = suspensionDraftSchema.extend({
  reason: z.string().trim().min(1).max(500),
  request_id: z.uuid(), expected_fingerprint: z.string().length(64),
});
const previewSchema = z.object({
  enrollment_id: z.uuid(), suspension_id: z.uuid().nullable(), student_name: z.string(), class_name: z.string(),
  suspended_from: z.iso.date(), resume_on: z.iso.date(), calendar_days: z.number().int(),
  previous_preserved_days: z.number().int(), preserved_days: z.number().int(), delta_days: z.number().int(),
  overlap_or_waived_days: z.number().int(), target_coverage_start: z.iso.date().nullable(),
  old_due_date: z.iso.date().nullable(), new_due_date: z.iso.date().nullable(), pending_days: z.number().int(),
  protected_count: z.number().int(), late_report: z.boolean(), fingerprint: z.string().length(64), warnings: z.array(z.string()),
});
const rowSchema = z.object({
  id: z.uuid(), enrollment_id: z.uuid(), suspended_from: z.iso.date(), resume_on: z.iso.date(),
  status: z.enum(["ACTIVE", "CANCELLED"]), version: z.number().int(), reason: z.string(), updated_at: z.iso.datetime({ offset: true }),
});
const listSchema = z.object({ items: z.array(rowSchema), total: z.number().int(), pending_days: z.number().int() });
export type SuspensionDraft = z.infer<typeof suspensionDraftSchema>;
export type SuspensionCommand = z.infer<typeof suspensionCommandSchema>;
export type IndividualSuspensionPreview = z.infer<typeof previewSchema>;
export type IndividualSuspensionRow = z.infer<typeof rowSchema>;

export async function previewIndividualSuspension(id: string, draft: SuspensionDraft) {
  return previewSchema.parse((await apiClient.post(`/enrollments/${id}/suspensions/preview`, draft)).data);
}
export async function applyIndividualSuspension(id: string, command: SuspensionCommand) {
  return previewSchema.parse((await apiClient.post(`/enrollments/${id}/suspensions`, command)).data);
}
export async function listIndividualSuspensions(id: string, year: number, offset: number, signal?: AbortSignal) {
  return listSchema.parse((await apiClient.get(`/enrollments/${id}/suspensions`, { params: { year, offset, limit: 10 }, signal })).data);
}
