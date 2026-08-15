import { apiClient } from "@/lib/api/client";
import {
  enrollmentResponseSchema,
  studentIdentityConflictSchema,
  studentResponseListSchema,
  studentResponseSchema,
} from "@/lib/schemas/student";
import axios from "axios";
import type {
  EnrollmentCreate,
  EnrollmentResponse,
  EnrollmentUpdate,
  StudentCreate,
  StudentIdentityConflict,
  StudentReactivationRequest,
  StudentResponse,
  StudentStatus,
  StudentUpdate,
} from "@/lib/types";

type GetStudentsParams = {
  search?: string;
  class_id?: string;
  status?: StudentStatus | "";
};

export async function getStudents(params: GetStudentsParams): Promise<StudentResponse[]> {
  const students: StudentResponse[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  // The API uses keyset pagination. A class normally contains far fewer than
  // 500 students, but following the cursor prevents silent row loss for large
  // searches and keeps the existing page contract backwards compatible.
  for (let page = 0; page < 100; page += 1) {
    const response = await apiClient.get<unknown>("/students", {
      params: {
        search: params.search || undefined,
        class_id: params.class_id || undefined,
        status: params.status || undefined,
        cursor,
        limit: 500,
      },
    });
    const items = studentResponseListSchema.parse(response.data);
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        students.push(item);
      }
    }

    const hasMore = response.headers["x-has-more"] === "true";
    const nextCursor = response.headers["x-next-cursor"] as string | undefined;
    if (!hasMore || !nextCursor || nextCursor === cursor) {
      return students;
    }
    cursor = nextCursor;
  }

  throw new Error("Danh sách học viên vượt quá giới hạn tải an toàn.");
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

export async function updateStudent(
  id: string,
  data: StudentUpdate,
): Promise<StudentResponse> {
  const response = await apiClient.patch<unknown>(`/students/${id}`, data);
  return studentResponseSchema.parse(response.data);
}

export async function updateEnrollment(
  id: string,
  data: EnrollmentUpdate,
): Promise<EnrollmentResponse> {
  const response = await apiClient.patch<unknown>(`/enrollments/${id}`, data);
  return enrollmentResponseSchema.parse(response.data);
}

export async function createEnrollment(
  data: EnrollmentCreate,
): Promise<EnrollmentResponse> {
  const response = await apiClient.post<unknown>("/enrollments", data);
  return enrollmentResponseSchema.parse(response.data);
}

export async function dropEnrollment(id: string): Promise<EnrollmentResponse> {
  const response = await apiClient.delete<unknown>(`/enrollments/${id}`);
  return enrollmentResponseSchema.parse(response.data);
}
