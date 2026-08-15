import { apiClient } from "@/lib/api/client";
import {
  classAdjustmentListSchema,
  classEndDatePreviewSchema,
  classHistorySchema,
  classOccurrenceListSchema,
  classResponseListSchema,
  classResponseSchema,
  classScheduleAvailabilityResponseSchema,
  classScopeSummarySchema,
  classSessionExceptionSchema,
  exceptionCommandSchema,
  makeupSchedulePreviewSchema,
  postponementCreateSchema,
  postponementPreviewSchema,
} from "@/lib/schemas/class";
import type {
  ClassAdjustmentListResponse,
  ClassCreate,
  ClassEndDateUpdate,
  ClassEndDatePreview,
  ClassHistory,
  ClassOccurrenceListResponse,
  ClassResponse,
  ClassScheduleAvailabilityConflict,
  ClassScheduleAvailabilityRequest,
  ClassScope,
  ClassScopeSummary,
  ClassSessionExceptionResponse,
  ClassType,
  ClassUpdate,
  ExceptionCommandResponse,
  MakeupCommandRequest,
  MakeupSchedulePreviewResponse,
  MakeupScheduleRequest,
  PostponementCreateRequest,
  PostponementCreateResponse,
  PostponementPreviewResponse,
} from "@/lib/types";

type GetClassesParams = {
  search?: string;
  type?: ClassType | "";
  is_active?: boolean;
  scope?: ClassScope;
};

export async function getClasses(params: GetClassesParams): Promise<ClassResponse[]> {
  const { data } = await apiClient.get<ClassResponse[]>("/classes", {
    params: {
      search: params.search || undefined,
      type: params.type || undefined,
      is_active: params.is_active,
      scope: params.scope,
    },
  });

  return classResponseListSchema.parse(data);
}

export async function getClassScopeSummary(): Promise<ClassScopeSummary> {
  const response = await apiClient.get<ClassScopeSummary>("/classes/summary");
  return classScopeSummarySchema.parse(response.data);
}

export async function getClassDetail(id: string): Promise<ClassResponse> {
  const response = await apiClient.get<ClassResponse>(`/classes/${id}`);
  return classResponseSchema.parse(response.data);
}

export async function createClass(data: ClassCreate): Promise<ClassResponse> {
  const response = await apiClient.post<ClassResponse>("/classes", data);
  return classResponseSchema.parse(response.data);
}

export async function updateClass(id: string, data: ClassUpdate): Promise<ClassResponse> {
  const response = await apiClient.patch<ClassResponse>(`/classes/${id}`, data);
  return classResponseSchema.parse(response.data);
}

export async function previewClassEndDate(
  id: string,
  data: Pick<ClassEndDateUpdate, "end_date" | "expected_version">,
): Promise<ClassEndDatePreview> {
  const response = await apiClient.post<ClassEndDatePreview>(
    `/classes/${id}/end-date/preview`,
    data,
  );
  return classEndDatePreviewSchema.parse(response.data);
}

export async function deleteClass(id: string): Promise<void> {
  await apiClient.delete(`/classes/${id}`);
}

export async function getClassHistory(id: string): Promise<ClassHistory> {
  const response = await apiClient.get<ClassHistory>(`/classes/${id}/history`);
  return classHistorySchema.parse(response.data);
}

export async function getClassScheduleAvailability(
  payload: ClassScheduleAvailabilityRequest,
): Promise<ClassScheduleAvailabilityConflict[]> {
  const response = await apiClient.post<{
    conflicts: ClassScheduleAvailabilityConflict[];
  }>("/classes/schedule-availability", payload);
  return classScheduleAvailabilityResponseSchema.parse(response.data).conflicts;
}

export async function getClassOccurrences(
  classId: string,
  from: string,
  to: string,
): Promise<ClassOccurrenceListResponse> {
  const response = await apiClient.get<ClassOccurrenceListResponse>(
    `/classes/${classId}/occurrences`,
    { params: { from, to } },
  );
  return classOccurrenceListSchema.parse(response.data);
}

export type EffectiveOccurrenceSummary = {
  class_id: string;
  occurrences: Array<{
    key: string;
    kind: "REGULAR" | "POSTPONED" | "MAKEUP";
    original_start_at: string;
    original_end_at: string;
    source_slot_key: string;
    exception_id: string | null;
    status: string | null;
    replacement_start_at: string | null;
    replacement_end_at: string | null;
  }>;
};

export async function getEffectiveOccurrences(
  from: string,
  to: string,
): Promise<EffectiveOccurrenceSummary[]> {
  const response = await apiClient.get<EffectiveOccurrenceSummary[]>(
    "/classes/effective-occurrences",
    { params: { from, to } },
  );
  return response.data;
}

export async function getClassAdjustments(
  classId: string,
  filters: { status?: string } = {},
): Promise<ClassAdjustmentListResponse> {
  const response = await apiClient.get<ClassAdjustmentListResponse>(
    `/classes/${classId}/schedule-adjustments`,
    { params: { status: filters.status || undefined, limit: 50 } },
  );
  return classAdjustmentListSchema.parse(response.data);
}

export async function getClassSessionException(
  exceptionId: string,
): Promise<ClassSessionExceptionResponse> {
  const response = await apiClient.get<ClassSessionExceptionResponse>(
    `/class-session-exceptions/${exceptionId}`,
  );
  return classSessionExceptionSchema.parse(response.data);
}

export async function previewPostponement(
  classId: string,
  fromDate: string,
  toDate: string,
): Promise<PostponementPreviewResponse> {
  const response = await apiClient.post<PostponementPreviewResponse>(
    `/classes/${classId}/schedule-adjustments/preview`,
    { from_date: fromDate, to_date: toDate },
  );
  return postponementPreviewSchema.parse(response.data);
}

export async function createPostponement(
  classId: string,
  payload: PostponementCreateRequest,
): Promise<PostponementCreateResponse> {
  const response = await apiClient.post<PostponementCreateResponse>(
    `/classes/${classId}/schedule-adjustments`,
    payload,
  );
  return postponementCreateSchema.parse(response.data);
}

export async function previewMakeupSchedule(
  exceptionId: string,
  replacementStartAt: string,
): Promise<MakeupSchedulePreviewResponse> {
  const response = await apiClient.post<MakeupSchedulePreviewResponse>(
    `/class-session-exceptions/${exceptionId}/makeup/preview`,
    { replacement_start_at: replacementStartAt },
  );
  return makeupSchedulePreviewSchema.parse(response.data);
}

export async function scheduleMakeup(
  exceptionId: string,
  payload: MakeupScheduleRequest,
): Promise<ExceptionCommandResponse> {
  const response = await apiClient.post<ExceptionCommandResponse>(
    `/class-session-exceptions/${exceptionId}/makeup/schedule`,
    payload,
  );
  return exceptionCommandSchema.parse(response.data);
}

export async function unscheduleMakeup(
  exceptionId: string,
  payload: MakeupCommandRequest,
): Promise<ExceptionCommandResponse> {
  const response = await apiClient.post<ExceptionCommandResponse>(
    `/class-session-exceptions/${exceptionId}/makeup/unschedule`,
    payload,
  );
  return exceptionCommandSchema.parse(response.data);
}

export async function completeMakeup(
  exceptionId: string,
  payload: MakeupCommandRequest,
): Promise<ExceptionCommandResponse> {
  const response = await apiClient.post<ExceptionCommandResponse>(
    `/class-session-exceptions/${exceptionId}/makeup/complete`,
    payload,
  );
  return exceptionCommandSchema.parse(response.data);
}

export async function restoreOriginalSession(
  exceptionId: string,
  payload: MakeupCommandRequest,
): Promise<ExceptionCommandResponse> {
  const response = await apiClient.post<ExceptionCommandResponse>(
    `/class-session-exceptions/${exceptionId}/restore-original`,
    payload,
  );
  return exceptionCommandSchema.parse(response.data);
}
