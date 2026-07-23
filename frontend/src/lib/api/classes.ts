import { apiClient } from "@/lib/api/client";
import { classResponseListSchema, classResponseSchema } from "@/lib/schemas/class";
import type { ClassCreate, ClassResponse, ClassType, ClassUpdate } from "@/lib/types";

type GetClassesParams = {
  search?: string;
  type?: ClassType | "";
  is_active?: boolean;
};

export async function getClasses(params: GetClassesParams): Promise<ClassResponse[]> {
  const { data } = await apiClient.get<ClassResponse[]>("/classes", {
    params: {
      search: params.search || undefined,
      type: params.type || undefined,
      is_active: params.is_active,
    },
  });

  return classResponseListSchema.parse(data);
}

export async function createClass(data: ClassCreate): Promise<ClassResponse> {
  const response = await apiClient.post<ClassResponse>("/classes", data);
  return classResponseSchema.parse(response.data);
}

export async function updateClass(id: string, data: ClassUpdate): Promise<ClassResponse> {
  const response = await apiClient.patch<ClassResponse>(`/classes/${id}`, data);
  return classResponseSchema.parse(response.data);
}

export async function archiveClass(id: string): Promise<void> {
  await apiClient.delete(`/classes/${id}`);
}
