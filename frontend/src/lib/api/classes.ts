import { apiClient } from "@/lib/api/client";
import {
  classAdjustmentListSchema,
  classStartDatePreviewSchema,
  classBillingCyclePreviewSchema,
  classBillingCycleUpdateResponseSchema,
  classStopPreviewSchema,
  classContinuationCreateResponseSchema,
  classContinuationPreviewSchema,
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
  staffAvailabilityPreviewResponseSchema,
  suspensionPreviewSchema,
} from "@/lib/schemas/class";
import type {
  ClassAdjustmentListResponse,
  ClassCreate,
  ClassContinuationCreate,
  ClassContinuationCreateResponse,
  ClassContinuationPreview,
  ClassStartDatePreview,
  ClassBillingCyclePreview,
  ClassBillingCycleUpdateResponse,
  ClassStopPreview,
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
  MakeupReasonCode,
  PostponementCreateRequest,
  PostponementCreateResponse,
  PostponementPreviewResponse,
  StaffAvailabilityPreviewRequest,
  StaffAvailabilityPreviewResponse,
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

export async function getClassContinuationPreview(
  id: string,
): Promise<ClassContinuationPreview> {
  const response = await apiClient.get<unknown>(`/classes/${id}/continuation-preview`);
  return classContinuationPreviewSchema.parse(response.data);
}

export async function createClassContinuation(
  id: string,
  data: ClassContinuationCreate,
): Promise<ClassContinuationCreateResponse> {
  const response = await apiClient.post<unknown>(`/classes/${id}/continuation`, data, {
    // A full cohort is persisted atomically. Keep this request alive beyond
    // the global interactive-request limit while the server finishes safely.
    timeout: 60_000,
  });
  return classContinuationCreateResponseSchema.parse(response.data);
}

export async function updateClass(id: string, data: ClassUpdate): Promise<ClassResponse> {
  const response = await apiClient.patch<ClassResponse>(`/classes/${id}`, data);
  return classResponseSchema.parse(response.data);
}

export async function previewClassStartDate(
  id: string,
  data: {
    start_date: string;
    expected_version: number;
    default_decision?: string;
    enrollment_decisions?: Record<string, string>;
    class_patch?: ClassUpdate;
  },
): Promise<ClassStartDatePreview> {
  const response = await apiClient.post<ClassStartDatePreview>(
    `/classes/${id}/start-date/preview`,
    data,
  );
  return classStartDatePreviewSchema.parse(response.data);
}

export async function updateClassStartDate(
  id: string,
  data: {
    start_date: string;
    reason: string;
    expected_version: number;
    expected_fingerprint: string;
    request_id?: string;
    default_decision?: string;
    enrollment_overrides?: Array<{
      enrollment_id: string;
      decision_code: string;
      selected_historical_cycles?: number[];
    }>;
    class_patch?: ClassUpdate;
  },
): Promise<ClassResponse> {
  const response = await apiClient.post<ClassResponse>(`/classes/${id}/start-date/apply`, data);
  return classResponseSchema.parse(response.data);
}

export async function previewClassBillingCycle(
  id: string,
  data: { billing_cycle_weeks: number; expected_version: number },
): Promise<ClassBillingCyclePreview> {
  const response = await apiClient.post<unknown>(
    `/classes/${id}/billing-cycle/preview`,
    data,
  );
  return classBillingCyclePreviewSchema.parse(response.data);
}

export async function updateClassBillingCycle(
  id: string,
  data: {
    billing_cycle_weeks: number;
    reason: string;
    request_id: string;
    expected_version: number;
    expected_fingerprint: string;
  },
): Promise<ClassBillingCycleUpdateResponse> {
  const response = await apiClient.post<unknown>(`/classes/${id}/billing-cycle`, data, {
    timeout: 60_000,
  });
  return classBillingCycleUpdateResponseSchema.parse(response.data);
}

export async function previewClassStop(
  id: string,
  expectedVersion: number,
): Promise<ClassStopPreview> {
  const response = await apiClient.post<ClassStopPreview>(`/classes/${id}/stop/preview`, {
    expected_version: expectedVersion,
  });
  return classStopPreviewSchema.parse(response.data);
}

export async function stopClass(
  id: string,
  data: {
    reason: string;
    request_id: string;
    expected_version: number;
    expected_fingerprint: string;
  },
): Promise<ClassResponse> {
  const response = await apiClient.post<ClassResponse>(`/classes/${id}/stop`, data);
  return classResponseSchema.parse(response.data);
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

export async function previewStaffAvailability(
  payload: StaffAvailabilityPreviewRequest,
  options?: { signal?: AbortSignal },
): Promise<StaffAvailabilityPreviewResponse> {
  const response = await apiClient.post<StaffAvailabilityPreviewResponse>(
    "/classes/staff-availability",
    payload,
    { signal: options?.signal },
  );
  return staffAvailabilityPreviewResponseSchema.parse(response.data);
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

export async function previewClassSuspension(
  classId: string,
  payload: { suspended_from: string; resume_on: string },
) {
  const response = await apiClient.post(
    `/classes/${classId}/suspensions/preview`,
    payload,
  );
  return suspensionPreviewSchema.parse(response.data);
}

export async function createClassSuspension(
  classId: string,
  payload: {
    suspended_from: string;
    resume_on: string;
    reason_code: MakeupReasonCode;
    reason_note?: string | null;
    request_id: string;
  },
) {
  const response = await apiClient.post(
    `/classes/${classId}/suspensions`,
    payload,
  );
  return suspensionPreviewSchema.parse(response.data);
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
