import { apiClient } from "@/lib/api/client";
import {
  staffResponseListSchema,
  staffResponseSchema,
  teacherOptionResponseListSchema,
} from "@/lib/schemas/staff";
import type { StaffCreate, StaffResponse, StaffType, StaffUpdate, TeacherOptionResponse } from "@/lib/types";
import { z } from "zod";

const payrollRateSchema = z.object({
  id: z.string().uuid(),
  rate_amount: z.number().int(),
  assignment_role: z.enum(["TEACHER", "ASSISTANT"]).nullable().nullish().default(null),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  version: z.number().int(),
});
const payrollSettlementSchema = z.object({
  id: z.string().uuid(), total_amount: z.number().int(), cutoff_at: z.string(),
  method: z.string(), reference: z.string().nullable(), created_at: z.string(),
  settlement_account_id: z.string().uuid().nullable().default(null),
  settlement_bank_code: z.string().nullable().default(null),
  settlement_bank_name: z.string().nullable().default(null),
  settlement_account_number: z.string().nullable().default(null),
  settlement_account_name: z.string().nullable().default(null),
  reversed_at: z.string().nullable(),
});
const payrollSettlementReversalSchema = z.object({
  id: z.string().uuid(), settlement_id: z.string().uuid(), staff_id: z.string().uuid(),
  request_id: z.string().uuid(), reason: z.string(), created_at: z.string(),
});
const payrollSummarySchema = z.object({
  staff_id: z.string().uuid(), balance: z.number().int(),
  rates: z.array(payrollRateSchema), settlements: z.array(payrollSettlementSchema),
});
export type StaffPayrollSummary = z.infer<typeof payrollSummarySchema>;

const attendanceHistoryItemSchema = z.object({
  attendance_id: z.string().uuid(),
  class_name: z.string().nullable(),
  role: z.string(),
  occurrence_start_at: z.string(),
  occurrence_end_at: z.string(),
  kind: z.string(),
  checkin_at: z.string(),
  rate_amount: z.number().int(),
  rate_version: z.number().int(),
  reversed_at: z.string().nullable().nullish().default(null),
  reversal_reason: z.string().nullable().nullish().default(null),
});
const attendanceHistorySchema = z.object({
  staff_id: z.string().uuid(),
  items: z.array(attendanceHistoryItemSchema),
});
export type StaffAttendanceHistory = z.infer<typeof attendanceHistorySchema>;

const manualAttendanceTargetSchema = z.object({
  occurrence_id: z.string().uuid(),
  class_name: z.string(),
  role: z.string(),
  occurrence_start_at: z.string(),
  occurrence_end_at: z.string(),
  kind: z.string(),
  rate_amount: z.number().int().nullable(),
});
export type ManualAttendanceTarget = z.infer<typeof manualAttendanceTargetSchema>;

const attendanceCheckInSchema = z.object({
  attendance_id: z.string().uuid(),
  status: z.literal("CHECKED_IN"),
  checkin_at: z.string(),
  rate_amount: z.number().int(),
  occurrence_start_at: z.string(),
});
export type AttendanceCheckIn = z.infer<typeof attendanceCheckInSchema>;

const attendanceReversalSchema = z.object({
  attendance_id: z.string().uuid(),
  reversed_at: z.string(),
  reason: z.string(),
});
export type AttendanceReversal = z.infer<typeof attendanceReversalSchema>;

type GetStaffParams = {
  staff_type?: StaffType;
  is_active?: boolean | null;
};

export async function getStaffMembers(params: GetStaffParams = {}): Promise<StaffResponse[]> {
  const { data } = await apiClient.get<StaffResponse[]>("/staff", {
    params: {
      staff_type: params.staff_type || undefined,
      is_active: params.is_active === null ? undefined : (params.is_active ?? true),
    },
  });
  return staffResponseListSchema.parse(data);
}

export async function getActiveStaffOptions(): Promise<TeacherOptionResponse[]> {
  const { data } = await apiClient.get<TeacherOptionResponse[]>("/staff/options");
  return teacherOptionResponseListSchema.parse(data);
}

export async function getActiveTeacherOptions(): Promise<TeacherOptionResponse[]> {
  return getActiveStaffOptions();
}

export async function createStaffMember(data: StaffCreate): Promise<StaffResponse> {
  const response = await apiClient.post<StaffResponse>("/staff", data);
  return staffResponseSchema.parse(response.data);
}

export async function updateStaffMember(
  id: string,
  data: StaffUpdate,
): Promise<StaffResponse> {
  const response = await apiClient.patch<StaffResponse>(`/staff/${id}`, data);
  return staffResponseSchema.parse(response.data);
}

export async function getStaffPayroll(id: string): Promise<StaffPayrollSummary> {
  const { data } = await apiClient.get(`/staff/${id}/payroll`);
  return payrollSummarySchema.parse(data);
}

export async function getStaffAttendanceHistory(
  id: string,
): Promise<StaffAttendanceHistory> {
  const { data } = await apiClient.get(`/staff/${id}/attendance-history`);
  return attendanceHistorySchema.parse(data);
}

export async function getManualAttendanceTargets(
  id: string,
): Promise<ManualAttendanceTarget[]> {
  const { data } = await apiClient.get(`/staff/${id}/attendance/manual-targets`);
  return z.array(manualAttendanceTargetSchema).parse(data);
}

export async function createManualAttendance(
  id: string,
  payload: { occurrence_id: string; request_id: string; reason?: string | null },
): Promise<AttendanceCheckIn> {
  const { data } = await apiClient.post(`/staff/${id}/attendance/manual`, payload);
  return attendanceCheckInSchema.parse(data);
}

export async function reverseAttendance(
  staffId: string,
  attendanceId: string,
  payload: { request_id: string; reason: string },
): Promise<AttendanceReversal> {
  const { data } = await apiClient.post(
    `/staff/${staffId}/attendance/${attendanceId}/reversal`,
    payload,
  );
  return attendanceReversalSchema.parse(data);
}

export async function createStaffCompensationRate(
  id: string,
  payload: {
    rate_amount: number;
    assignment_role?: StaffType | null;
    effective_from: string;
    effective_to?: string | null;
    reason?: string | null;
  },
) {
  const { data } = await apiClient.post(`/staff/${id}/compensation-rates`, payload);
  return payrollRateSchema.parse(data);
}

export async function settleStaffPayroll(
  id: string,
  payload: {
    request_id: string;
    method: "bank_transfer" | "cash";
    settlement_account_id?: string | null;
    reference?: string | null;
  },
) {
  const { data } = await apiClient.post(`/staff/${id}/payroll/settlements`, payload);
  return payrollSettlementSchema.parse(data);
}

export async function reverseStaffPayrollSettlement(
  staffId: string,
  settlementId: string,
  payload: { request_id: string; reason: string },
) {
  const { data } = await apiClient.post(
    `/staff/${staffId}/payroll/settlements/${settlementId}/reversal`,
    payload,
  );
  return payrollSettlementReversalSchema.parse(data);
}
