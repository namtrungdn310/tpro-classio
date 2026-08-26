import type { StudentListState, StudentStatus } from "@/lib/types";

export type StudentListFilters = {
  class_id?: string;
  status?: StudentStatus | "";
  list_state?: StudentListState;
  search?: string;
  limit?: number;
};
function normalizeFilters(filters: StudentListFilters): StudentListFilters {
  return {
    class_id: filters.class_id || undefined,
    status: filters.status || undefined,
    list_state: filters.list_state,
    search: filters.search?.trim() || undefined,
    limit: filters.limit ?? 80,
  };
}

export const studentQueryKeys = {
  all: ["students"] as const,
  lists: () => [...studentQueryKeys.all, "list"] as const,
  list: (filters: StudentListFilters) =>
    [...studentQueryKeys.lists(), normalizeFilters(filters)] as const,
  summary: () => [...studentQueryKeys.all, "summary"] as const,
  details: () => [...studentQueryKeys.all, "detail"] as const,
  detail: (studentId: string | null | undefined) =>
    [...studentQueryKeys.details(), studentId ?? ""] as const,
  enrollments: (studentId: string) =>
    [...studentQueryKeys.detail(studentId), "enrollments"] as const,
};
