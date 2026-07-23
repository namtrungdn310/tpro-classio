import { apiClient } from "@/lib/api/client";
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
  const { data } = await apiClient.get<StudentResponse[]>("/students", {
    params: {
      search: params.search || undefined,
      class_id: params.class_id || undefined,
      status: params.status || undefined,
    },
  });
  return data;
}

export async function createStudent(data: StudentCreate): Promise<StudentResponse> {
  const response = await apiClient.post<StudentResponse>("/students", data);
  return response.data;
}

export async function updateStudent(
  id: string,
  data: StudentUpdate,
): Promise<StudentResponse> {
  const response = await apiClient.patch<StudentResponse>(`/students/${id}`, data);
  return response.data;
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
  const { data } = await apiClient.get<ContactSuggestionResponse | null>(
    "/students/contact-suggestion",
    { params: { owner, phone, zalo_name: zaloName } },
  );
  return data;
}

export async function updateEnrollment(
  id: string,
  data: EnrollmentUpdate,
): Promise<EnrollmentResponse> {
  const response = await apiClient.patch<EnrollmentResponse>(`/enrollments/${id}`, data);
  return response.data;
}

export async function createEnrollment(
  data: EnrollmentCreate,
): Promise<EnrollmentResponse> {
  const response = await apiClient.post<EnrollmentResponse>("/enrollments", data);
  return response.data;
}

export async function dropEnrollment(id: string): Promise<EnrollmentResponse> {
  const response = await apiClient.delete<EnrollmentResponse>(`/enrollments/${id}`);
  return response.data;
}
