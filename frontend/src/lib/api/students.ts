import { apiClient } from "@/lib/api/client";
import {
  contactSuggestionResponseSchema,
  enrollmentResponseSchema,
  studentResponseListSchema,
  studentResponseSchema,
} from "@/lib/schemas/student";
import type {
  EnrollmentCreate,
  EnrollmentResponse,
  EnrollmentUpdate,
  ContactSuggestionResponse,
  StudentCreate,
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
  const { data } = await apiClient.get<unknown>("/students", {
    params: {
      search: params.search || undefined,
      class_id: params.class_id || undefined,
      status: params.status || undefined,
    },
  });
  return studentResponseListSchema.parse(data);
}

export async function createStudent(data: StudentCreate): Promise<StudentResponse> {
  const response = await apiClient.post<unknown>("/students", data);
  return studentResponseSchema.parse(response.data);
}

export async function updateStudent(
  id: string,
  data: StudentUpdate,
): Promise<StudentResponse> {
  const response = await apiClient.patch<unknown>(`/students/${id}`, data);
  return studentResponseSchema.parse(response.data);
}

export async function lookupContactSuggestion({
  owner,
  phone,
  zaloName,
}: {
  owner: "student" | "parent";
  phone?: string;
  zaloName?: string;
}): Promise<ContactSuggestionResponse | null> {
  const { data } = await apiClient.get<unknown>(
    "/students/contact-suggestion",
    { params: { owner, phone, zalo_name: zaloName } },
  );
  return contactSuggestionResponseSchema.parse(data);
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
