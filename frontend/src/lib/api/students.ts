import { apiClient } from "@/lib/api/client";
import {
  enrollmentResponseSchema,
  studentIdentityConflictSchema,
  studentListPageResponseSchema,
  studentResponseSchema,
  studentScopeSummarySchema,
} from "@/lib/schemas/student";
import axios from "axios";
import { z } from "zod";
import type {
  EnrollmentResponse,
  StudentCreate,
  StudentIdentityConflict,
  StudentReactivationRequest,
  StudentResponse,
  StudentListPageResponse,
  StudentListState,
  StudentMembershipCommand,
  StudentScopeSummary,
  StudentStatus,
} from "@/lib/types";

export type GetStudentsParams = {
  search?: string;
  class_id?: string;
  status?: StudentStatus | "";
  list_state?: StudentListState;
  cursor?: string;
  limit?: number;
};

export async function getStudentsPage(
  params: GetStudentsParams,
  signal?: AbortSignal,
): Promise<StudentListPageResponse> {
  const response = await apiClient.get<unknown>("/students/page", {
    signal,
    params: {
      search: params.search || undefined,
      class_id: params.class_id || undefined,
      status: params.status || undefined,
      list_state: params.list_state || undefined,
      cursor: params.cursor || undefined,
      limit: params.limit ?? 80,
    },
  });
  return studentListPageResponseSchema.parse(response.data);
}

export async function getStudentScopeSummary(signal?: AbortSignal): Promise<StudentScopeSummary> {
  const response = await apiClient.get<unknown>("/students/summary", { signal });
  return studentScopeSummarySchema.parse(response.data);
}

export async function getStudent(id: string, signal?: AbortSignal): Promise<StudentResponse> {
  const response = await apiClient.get<unknown>(`/students/${id}`, { signal });
  return studentResponseSchema.parse(response.data);
}

export async function createStudent(data: StudentCreate): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>("/students", data);
  return studentResponseSchema.parse(response.data);
}

export async function reactivateStudent(
  id: string,
  data: StudentReactivationRequest,
): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>(`/students/${id}/reactivate`, data);
  return studentResponseSchema.parse(response.data);
}

export function getStudentIdentityConflict(
  error: unknown,
): StudentIdentityConflict | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) {
    return null;
  }

  const parsed = studentIdentityConflictSchema.safeParse(
    error.response.data?.detail,
  );
  return parsed.success ? parsed.data : null;
}

export async function applyStudentMembershipCommand(
  id: string,
  data: StudentMembershipCommand,
): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>(`/students/${id}/membership-command`, data);
  return studentResponseSchema.parse(response.data);
}

export async function archiveStudent(
  id: string,
  reason: string,
): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>(`/students/${id}/archive`, { reason });
  return studentResponseSchema.parse(response.data);
}

export async function restoreStudent(
  id: string,
  reason: string,
): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>(`/students/${id}/restore`, { reason });
  return studentResponseSchema.parse(response.data);
}

export async function getStudentEnrollments(
  id: string,
  signal?: AbortSignal,
): Promise<EnrollmentResponse[]> {
  const response = await apiClient.get<unknown>(`/students/${id}/enrollments`, { signal });
  return z.array(enrollmentResponseSchema).parse(response.data);
}

export async function dropEnrollment(id: string): Promise<EnrollmentResponse> {
  const response = await apiClient.delete<unknown>(`/enrollments/${id}`);
  return enrollmentResponseSchema.parse(response.data);
}
