import { apiClient } from "@/lib/api/client";
import {
  staffResponseListSchema,
  staffResponseSchema,
  teacherOptionResponseListSchema,
} from "@/lib/schemas/staff";
import type { StaffCreate, StaffResponse, StaffType, StaffUpdate, TeacherOptionResponse } from "@/lib/types";

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
