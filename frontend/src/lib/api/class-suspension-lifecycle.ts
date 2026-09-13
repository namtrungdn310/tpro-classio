import { z } from "zod";
import { apiClient } from "./client";

export const classSuspensionChangeSchema = z.object({
  resume_on: z.iso.date(), cancel: z.boolean(), reason: z.string().trim().min(1).max(500),
});
export const classSuspensionCommandSchema = classSuspensionChangeSchema.extend({
  request_id: z.uuid(), expected_fingerprint: z.string().length(64), adjustment_id: z.uuid(),
});
const previewSchema = z.object({
  adjustment_id: z.uuid(), previous_resume_on: z.iso.date(), resume_on: z.iso.date(), cancel: z.boolean(),
  restore_count: z.number().int(), suspend_count: z.number().int(), fingerprint: z.string().length(64), blocked_reasons: z.array(z.string()),
  member_summary: z.array(z.object({ enrollment_id: z.uuid(), student_name: z.string().nullable(), overlap_days: z.number().int(),
    old_due_date: z.iso.date().nullable(), new_due_date: z.iso.date().nullable(), pending_days: z.number().int() })),
});
const rowSchema = z.object({ id: z.uuid(), suspended_from: z.iso.date(), resume_on: z.iso.date(), status: z.enum(["OPEN", "CLOSED"]), reason: z.string(), version: z.number().int() });
const listingSchema = z.object({ items: z.array(rowSchema), total: z.number().int() });
export type ClassPauseChange = z.infer<typeof classSuspensionChangeSchema>;
export type ClassPauseCommand = z.infer<typeof classSuspensionCommandSchema>;
export type ClassPausePreview = z.infer<typeof previewSchema>;
export type ClassPauseRow = z.infer<typeof rowSchema>;
export async function listClassPauses(classId: string, year: number, offset: number, signal?: AbortSignal) {
  return listingSchema.parse((await apiClient.get(`/classes/${classId}/suspensions`, { params: { year, offset, limit: 10 }, signal })).data);
}
export async function previewClassPauseChange(classId: string, id: string, data: ClassPauseChange) {
  return previewSchema.parse((await apiClient.post(`/classes/${classId}/suspensions/${id}/preview`, data)).data);
}
export async function applyClassPauseChange(classId: string, command: ClassPauseCommand) {
  const { adjustment_id, ...payload } = command;
  return previewSchema.parse((await apiClient.post(`/classes/${classId}/suspensions/${adjustment_id}`, payload)).data);
}
