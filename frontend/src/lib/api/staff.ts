import { apiClient } from "@/lib/api/client";
import {
  staffResponseListSchema,
  staffResponseSchema,
  teacherOptionResponseListSchema,
} from "@/lib/schemas/staff";
import type { StaffCreate, StaffResponse, StaffType, StaffUpdate, TeacherOptionResponse } from "@/lib/types";
import { z } from "zod";

const payrollRateSchema = z.object({
  id: z.string().uuid(), rate_amount: z.number().int(), effective_from: z.string(),
  effective_to: z.string().nullable(), version: z.number().int(),
});
const payrollSettlementSchema = z.object({
  id: z.string().uuid(), total_amount: z.number().int(), cutoff_at: z.string(),
  method: z.string(), reference: z.string().nullable(), created_at: z.string(),
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

type GetStaffParams = {
  staff_type?: StaffType;
  is_active?: boolean | null;
};

export async function getStaffMembers(params: GetStaffParams = {}): Promise<StaffResponse[]> {
  const { data } = await apiClient.get<StaffResponse[]>("/staff", {
    params: {
      staff_type: params.staff_type,
      is_active: params.is_active === null ? undefined : (params.is_active ?? true),
    },
  });
  return staffResponseListSchema.parse(data);
}

export async function getActiveTeacherOptions(): Promise<TeacherOptionResponse[]> {
  const { data } = await apiClient.get<TeacherOptionResponse[]>("/staff/teacher-options");
  return teacherOptionResponseListSchema.parse(data);
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

export async function createStaffCompensationRate(
  id: string,
  payload: { rate_amount: number; effective_from: string; effective_to?: string | null },
) {
  const { data } = await apiClient.post(`/staff/${id}/compensation-rates`, payload);
  return payrollRateSchema.parse(data);
}

export async function settleStaffPayroll(
  id: string,
  payload: { request_id: string; method: "bank_transfer" | "cash"; reference?: string | null },
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
