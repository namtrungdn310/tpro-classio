import type { ClassScope } from "@/lib/types";

/**
 * Class visibility changes at midnight in the centre's timezone. Including the
 * business date in a key prevents a stale client cache from showing a finished
 * class after that boundary, while preserving normal React Query navigation.
 */
export function vietnamBusinessDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export type ClassOccurrenceRange = {
  from: string;
  to: string;
};

export type ClassAvailabilityInput = {
  classId: string | null;
  startDate: string;
  teacherIds: string[];
  assistantIds: string[];
  scope?: "selected_staff" | "all_classes";
};

/** Canonical class query keys — mọi literal ["classes", ...] phải đến từ đây. */
export const classQueryKeys = {
  all: ["classes"] as const,
  summary: (dateKey = vietnamBusinessDateKey()) =>
    ["classes", "summary", dateKey] as const,
  list: (scope: ClassScope, dateKey = vietnamBusinessDateKey()) =>
    ["classes", { scope, dateKey }] as const,
  detail: (classId: string) => ["classes", "detail", classId] as const,
  history: (classId: string) => ["classes", "history", classId] as const,
  continuationPreview: (classId: string) =>
    ["classes", "continuation-preview", classId] as const,
  occurrences: (classId: string, range: ClassOccurrenceRange) =>
    ["classes", "occurrences", classId, range] as const,
  adjustments: (classId: string, filters: { status?: string }) =>
    ["classes", "adjustments", classId, filters] as const,
  suspensionPreview: (classId: string, from: string, to: string) =>
    ["classes", "suspension-preview", classId, from, to] as const,
  effectiveOccurrences: (from: string, to: string) =>
    ["classes", "effective-occurrences", from, to] as const,
  exception: (exceptionId: string) =>
    ["classes", "exception", exceptionId] as const,
  makeupSchedulePreview: (exceptionId: string, scheduleTime: string) =>
    ["classes", "makeup-schedule-preview", exceptionId, scheduleTime] as const,
  availability: (input: ClassAvailabilityInput) =>
    [
      "classes",
      "schedule-availability",
      input.classId ?? "new",
      input.startDate,
      [...input.teacherIds].sort().join(","),
      [...input.assistantIds].sort().join(","),
      input.scope ?? "selected_staff",
    ] as const,
};
