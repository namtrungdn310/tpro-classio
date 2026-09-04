import { isValidIsoDate } from "@/components/ui/manual-date-input";

export interface EnrollmentTargetConfig {
  class_id: string;
  enrollment_date: string | null; // ISO YYYY-MM-DD
  custom_fee: number | null;
  selected_slot_ids?: string[] | null;
}

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Ho_Chi_Minh timezone.
 */
export function getBusinessTodayInVietnam(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/**
 * Computes default enrollment date:
 * If class has a start_date strictly after business today, use start_date; otherwise today.
 */
export function getDefaultTargetEnrollmentDate(
  class_?: { start_date?: string | null } | null
): string {
  const today = getBusinessTodayInVietnam();
  if (class_?.start_date && class_.start_date > today) {
    return class_.start_date;
  }
  return today;
}

/**
 * Validates target enrollment date string.
 * Allows empty/incomplete values during active typing without premature blocking,
 * but returns an explicit error message on blur or apply if invalid.
 */
export function validateTargetEnrollmentDate(
  value: string | null | undefined
): { isValid: boolean; error: string | null } {
  if (!value || value.trim() === "") {
    return {
      isValid: false,
      error: "Vui lòng nhập ngày bắt đầu.",
    };
  }

  const trimmed = value.trim();
  if (!isValidIsoDate(trimmed)) {
    return {
      isValid: false,
      error: "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.",
    };
  }

  return { isValid: true, error: null };
}

/**
 * Filters schedule slots that are effective on a given ISO date:
 * slot.effective_from <= dateIso && (!slot.effective_until || slot.effective_until > dateIso)
 */
export function filterEffectiveSlotsForDate<
  T extends { effective_from: string; effective_until?: string | null }
>(slots: T[], dateIso: string): T[] {
  if (!isValidIsoDate(dateIso)) {
    return slots;
  }
  return slots.filter((slot) => {
    const fromOk = slot.effective_from <= dateIso;
    const untilOk = !slot.effective_until || slot.effective_until > dateIso;
    return fromOk && untilOk;
  });
}

/**
 * Computes a deterministic string key for the current draft to detect changes.
 */
export function computeDraftKey(
  mode: string,
  sourceEnrollmentId: string | null,
  targets: EnrollmentTargetConfig[]
): string {
  const sortedTargets = [...targets]
    .sort((a, b) => a.class_id.localeCompare(b.class_id))
    .map((t) => ({
      class_id: t.class_id,
      enrollment_date: t.enrollment_date ?? "",
      custom_fee: t.custom_fee ?? null,
      selected_slot_ids: [...(t.selected_slot_ids || [])].sort(),
    }));

  return `${mode}::${sourceEnrollmentId || "none"}::${JSON.stringify(sortedTargets)}`;
}

/**
 * Determines whether a target configuration is dirty compared to baseline.
 */
export function isTargetDraftDirty(
  draft: EnrollmentTargetConfig,
  baseline?: EnrollmentTargetConfig | null
): boolean {
  if (!baseline) return true;
  if ((draft.enrollment_date ?? "") !== (baseline.enrollment_date ?? "")) return true;
  if (draft.custom_fee !== baseline.custom_fee) return true;

  const draftSlots = [...(draft.selected_slot_ids || [])].sort().join(",");
  const baselineSlots = [...(baseline.selected_slot_ids || [])].sort().join(",");
  return draftSlots !== baselineSlots;
}

export interface ParsedMembershipError {
  code: string;
  message: string;
  class_id?: string;
  conflicting_class_id?: string;
  field?: string;
}

/**
 * Parses any backend error into a normalized structured object.
 */
export function parseMembershipError(error: unknown): ParsedMembershipError {
  if (!error) {
    return {
      code: "UNKNOWN_ERROR",
      message: "Đã có lỗi xảy ra. Vui lòng thử lại.",
    };
  }

  const errObj = error as Record<string, unknown>;
  const responseData = (errObj.response as { data?: unknown })?.data ?? errObj.data ?? errObj;

  if (responseData && typeof responseData === "object") {
    const data = responseData as Record<string, unknown>;

    // Case 1: detail is an object with code and message
    if (data.detail && typeof data.detail === "object" && !Array.isArray(data.detail)) {
      const detail = data.detail as Record<string, unknown>;
      const result: ParsedMembershipError = {
        code: typeof detail.code === "string" ? detail.code : "ERROR",
        message:
          typeof detail.message === "string"
            ? detail.message
            : "Đã có lỗi xảy ra. Vui lòng thử lại.",
      };
      if (typeof detail.class_id === "string") result.class_id = detail.class_id;
      if (typeof detail.conflicting_class_id === "string") {
        result.conflicting_class_id = detail.conflicting_class_id;
      }
      if (typeof detail.field === "string") result.field = detail.field;
      return result;
    }

    // Case 2: detail is a string
    if (typeof data.detail === "string") {
      return {
        code: "ERROR",
        message: data.detail,
      };
    }

    // Case 3: 422 validation array [{ loc, msg }]
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      const first = data.detail[0] as { msg?: string; loc?: string[] };
      const locStr = Array.isArray(first.loc) ? first.loc.join(".") : "";
      return {
        code: "VALIDATION_ERROR",
        message: first.msg ? `${first.msg}${locStr ? ` (${locStr})` : ""}` : "Dữ liệu không hợp lệ.",
      };
    }

    // Case 4: direct code/message on data
    if (typeof data.message === "string") {
      const result: ParsedMembershipError = {
        code: typeof data.code === "string" ? data.code : "ERROR",
        message: data.message,
      };
      if (typeof data.class_id === "string") result.class_id = data.class_id;
      if (typeof data.conflicting_class_id === "string") {
        result.conflicting_class_id = data.conflicting_class_id;
      }
      if (typeof data.field === "string") result.field = data.field;
      return result;
    }
  }

  if (error && typeof error === "object" && ("issues" in error || (error as Error).name === "ZodError")) {
    const zodError = error as { issues?: Array<{ message?: string; path?: Array<string | number> }> };
    const firstIssue = zodError.issues?.[0];
    const pathStr = firstIssue?.path?.length ? ` (${firstIssue.path.join(".")})` : "";
    return {
      code: "SCHEMA_PARSE_ERROR",
      message: firstIssue?.message
        ? `Dữ liệu không khớp định dạng: ${firstIssue.message}${pathStr}`
        : "Dữ liệu trả về không đúng định dạng.",
    };
  }

  if (error instanceof Error) {
    return {
      code: "CLIENT_ERROR",
      message: error.message,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Đã có lỗi xảy ra. Vui lòng thử lại.",
  };
}
