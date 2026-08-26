import type { ClassCategory, ClassEffectiveStatus, ClassResponse, ClassScheduleSlot, ClassType } from "@/lib/types";
import { getClassGroupInfo, getClassSortKey, type ClassGroupInfo } from "@/lib/utils/class-groups";
import { differenceInIsoDays } from "@/lib/classes/package-cycle";
import { differenceInIsoMonths, formatClassType, formatCurrency } from "@/lib/utils/format";
import {
  createPreparedSearchMatcher,
  prepareSearchCorpus,
  type PreparedSearchCorpus,
} from "@/lib/utils/search";

export const CLASS_DAYS = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ Nhật",
] as const;

export type ClassFilters = {
  search?: string | null;
  type?: ClassType | "" | null;
  courseDuration?: string | number | null;
  day?: string | null;
  category?: ClassCategory | "" | null;
  status?: ClassEffectiveStatus | "" | null;
};

export type ClassScheduleSummaryOptions = {
  day?: string | null;
  fallback?: string;
  maxSlots?: number;
};

export type PreparedClassRecord = {
  class_: ClassResponse;
  searchCorpus: PreparedSearchCorpus;
};

const CLASS_DAY_SET = new Set<string>(CLASS_DAYS);
const CLASS_DAY_ORDER = new Map<string, number>(
  CLASS_DAYS.map((day, index) => [day, index]),
);
const LEGACY_COURSE_MONTHS = new Set([2, 3, 6, 12]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function getClassTeacherIds(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "teacher_ids", "teacher_id");
}

export function getClassAssistantIds(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "assistant_ids", "assistant_id");
}

export function getClassGroupInfoForRecord(
  class_:
    | (Pick<ClassResponse, "name"> &
        Partial<Pick<ClassResponse, "class_category" | "grade_level">>)
    | null
    | undefined,
): ClassGroupInfo {
  const record = asRecord(class_);
  const category = getTrimmedString(record?.class_category);
  const gradeLevel = getFiniteNumber(record?.grade_level);

  if (category === "GENERAL" && gradeLevel !== null) {
    return getClassGroupInfo(`Lớp ${gradeLevel}`);
  }
  if (category === "SPECIALIZED") {
    return getClassGroupInfo("Chuyên");
  }
  if (category === "IELTS") {
    return getClassGroupInfo("IELTS");
  }
  if (category === "CUSTOM") {
    return getClassGroupInfo("Custom");
  }
  if (gradeLevel !== null) {
    return getClassGroupInfo(`Lớp ${gradeLevel}`);
  }
  return getClassGroupInfo(getTrimmedString(record?.name) ?? "");
}

export function getClassCategoryLabel(
  class_: ClassResponse | null | undefined,
): string {
  const category = getTrimmedString(asRecord(class_)?.class_category);
  const label = {
    GENERAL: "Phổ thông",
    SPECIALIZED: "Thi Chuyên",
    IELTS: "IELTS",
    CUSTOM: "Custom",
  }[category ?? ""];
  if (label) return label;
  return class_?.identity_scheme === "LEGACY" ? "Lớp cũ" : "Chưa phân loại";
}

export function getClassPeriodLabel(
  class_: ClassResponse | null | undefined,
): string | null {
  if (!class_) return null;
  // Lớp không có khối và năm học (IELTS/Custom) không hiển thị nhãn thời gian
  // phụ ("Mở lớp tháng/năm") ở cột Thời gian.
  if (!class_.grade_level && !class_.academic_year_start) return null;
  if (class_.class_category === "IELTS") {
    return class_.start_date
      ? `Mở lớp ${class_.start_date.slice(5, 7)}/${class_.start_date.slice(0, 4)}`
      : null;
  }
  if (class_.identity_scheme === "ACADEMIC_YEAR" && class_.academic_year_start) {
    const gradeLabel = class_.grade_level ? `Khối ${class_.grade_level}` : "Không theo khối";
    return `${gradeLabel} · Năm học ${class_.academic_year_start}–${class_.academic_year_start + 1}`;
  }
  return class_.secondary_label;
}

export function getClassGradeYearLabel(
  class_: ClassResponse | null | undefined,
): string | null {
  if (!class_) return null;
  const parts: string[] = [];
  if (class_.grade_level) parts.push(`Khối ${class_.grade_level}`);
  if (class_.academic_year_start) {
    parts.push(`Năm học ${class_.academic_year_start}–${class_.academic_year_start + 1}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function getClassInfoLine(class_: ClassResponse | null | undefined): string | null {
  if (!class_) return null;
  const parts = [getClassGradeYearLabel(class_), `${class_.student_count} học viên`].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function getClassTeacherNames(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "teacher_names", "teacher_name");
}

export function getClassAssistantNames(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "assistant_names", "assistant_name");
}

export function getClassScheduleSlots(
  class_: ClassResponse | null | undefined,
): ClassScheduleSlot[] {
  const schedule = asRecord(asRecord(class_)?.schedule);
  if (!Array.isArray(schedule?.slots)) {
    return [];
  }

  const slots = schedule.slots.flatMap((candidate) => {
    const slot = asRecord(candidate);
    const day = getTrimmedString(slot?.day);
    const start = getTrimmedString(slot?.start);
    const end = getTrimmedString(slot?.end);
    if (
      !day ||
      !CLASS_DAY_SET.has(day) ||
      !start ||
      !end ||
      !TIME_PATTERN.test(start) ||
      !TIME_PATTERN.test(end) ||
      toMinutes(start) >= toMinutes(end)
    ) {
      return [];
    }

    // Keep per-session staff assignments when the schedule is loaded for an
    // edit.  Older records may omit these fields (which intentionally keeps
    // the legacy class-level fallback), while an explicit empty array means
    // "this session has no assignment" and must not be silently replaced.
    const teacherIds = readOptionalStringList(slot?.teacher_ids);
    const assistantIds = readOptionalStringList(slot?.assistant_ids);
    return [
      {
        day: day as ClassScheduleSlot["day"],
        start,
        end,
        ...(teacherIds === undefined ? {} : { teacher_ids: teacherIds }),
        ...(assistantIds === undefined ? {} : { assistant_ids: assistantIds }),
      },
    ];
  });

  return normalizeClassScheduleSlots(slots);
}

export function normalizeClassScheduleSlots(
  slots: readonly ClassScheduleSlot[],
): ClassScheduleSlot[] {
  const seen = new Set<string>();

  return [...slots]
    .sort(compareScheduleSlots)
    .filter((slot) => {
      const key = `${slot.day}\u0000${slot.start}\u0000${slot.end}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * Teacher effective của một slot.  Một mảng rỗng là assignment rõ ràng và
 * phải được giữ nguyên để UI báo thiếu giáo viên; chỉ dữ liệu legacy thật sự
 * không có trường teacher_ids mới fallback tạm sang pool cấp lớp.
 */
export function getSlotEffectiveTeacherIds(
  slot: { teacher_ids?: readonly string[] },
  classTeacherPool: readonly string[],
): string[] {
  const explicit = slot.teacher_ids;
  return explicit !== undefined ? [...explicit] : [...classTeacherPool];
}

/**
 * Assistant effective của một slot — KHÔNG fallback: thiếu hoặc rỗng đều có
 * nghĩa là buổi đó không có trợ giảng.
 */
export function getSlotEffectiveAssistantIds(
  slot: { assistant_ids?: readonly string[] },
): string[] {
  const explicit = slot.assistant_ids;
  return explicit && explicit.length > 0 ? [...explicit] : [];
}

export function getClassScheduleSlotsLabel(
  slots: readonly ClassScheduleSlot[],
): string {
  const normalized = normalizeClassScheduleSlots(slots);
  return normalized.length
    ? normalized
        .map((slot) => `${slot.day}, ${slot.start} đến ${slot.end}`)
        .join("; ")
    : "Chưa thiết lập lịch học";
}

export function getClassScheduleText(class_: ClassResponse | null | undefined): string {
  const schedule = asRecord(asRecord(class_)?.schedule);
  return getTrimmedString(schedule?.text) ?? "";
}

export function getClassScheduleSummary(
  class_: ClassResponse | null | undefined,
  options: ClassScheduleSummaryOptions = {},
): string {
  const fallback = options.fallback ?? "—";
  const day = getTrimmedString(options.day);
  const slots = getClassScheduleSlots(class_).filter(
    (slot) => !day || slot.day === day,
  );
  const requestedLimit = options.maxSlots;
  const limit =
    typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
      ? Math.max(0, Math.floor(requestedLimit))
      : slots.length;

  if (slots.length > 0) {
    const visibleSlots = slots.slice(0, limit);
    const visibleSummary = visibleSlots
      .map((slot) => `${slot.day} (${slot.start}–${slot.end})`)
      .join(", ");
    const hiddenCount = slots.length - visibleSlots.length;
    if (!visibleSummary) {
      return hiddenCount > 0 ? `+${hiddenCount} ca` : fallback;
    }
    return hiddenCount > 0 ? `${visibleSummary} · +${hiddenCount} ca` : visibleSummary;
  }

  const scheduleText = getClassScheduleText(class_);
  if (!scheduleText) {
    return fallback;
  }
  if (day && !createPreparedSearchMatcher(day)(prepareSearchCorpus([scheduleText]))) {
    return fallback;
  }
  return scheduleText;
}

export function normalizeCourseBillingMonths(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && LEGACY_COURSE_MONTHS.has(value)
    ? value
    : 3;
}

export function normalizeCourseBillingWeeks(
  value: number | null | undefined,
  legacyMonths?: number | null,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return normalizeCourseBillingMonths(legacyMonths) * 4;
}

export function getCourseDurationLabel(
  value: number | null | undefined,
  legacyMonths?: number | null,
): string {
  return `${normalizeCourseBillingWeeks(value, legacyMonths)} tuần`;
}

export function getClassBillingDurationLabel(
  class_: ClassResponse | null | undefined,
): string {
  const record = asRecord(class_);
  if (record?.type === "MONTHLY") {
    return "1 tháng";
  }
  return getCourseDurationLabel(
    getFiniteNumber(record?.billing_cycle_weeks),
    getFiniteNumber(record?.billing_cycle_months),
  );
}

export function getClassBillingModeLabel(
  class_: ClassResponse | null | undefined,
): string {
  const record = asRecord(class_);
  if (record?.type === "MONTHLY") {
    return "Theo tháng";
  }
  return `Theo gói · ${getCourseDurationLabel(
    getFiniteNumber(record?.billing_cycle_weeks),
    getFiniteNumber(record?.billing_cycle_months),
  )}`;
}

/** Tổng thời lượng của khóa học: "(X tháng)" theo tháng hoặc "(X tuần)" theo gói. */
export function getClassTotalDurationLabel(
  class_: ClassResponse | null | undefined,
): string | null {
  const record = asRecord(class_);
  const start = getTrimmedString(record?.start_date);
  const end = getTrimmedString(record?.end_date);
  if (!start || !end) return null;
  if (record?.type === "MONTHLY") {
    return `${differenceInIsoMonths(start, end)} tháng`;
  }
  const totalWeeks = differenceInIsoDays(start, end) / 7;
  if (Number.isInteger(totalWeeks) && totalWeeks >= 1) {
    return `${totalWeeks} tuần`;
  }
  // Khóa học kéo dài không chia hết theo tuần (vd lớp IELTS dài kỳ) → dùng số
  // tuần theo chu kỳ thanh toán làm tổng thời lượng hiển thị.
  return getCourseDurationLabel(
    getFiniteNumber(record?.billing_cycle_weeks),
    getFiniteNumber(record?.billing_cycle_months),
  );
}

export function getClassEarliestStartMinutes(
  class_: ClassResponse | null | undefined,
  day: string | null | undefined,
): number {
  const normalizedDay = getTrimmedString(day);
  const starts = getClassScheduleSlots(class_)
    .filter((slot) => !normalizedDay || slot.day === normalizedDay)
    .map((slot) => toMinutes(slot.start));
  if (starts.length > 0) {
    return Math.min(...starts);
  }

  const timeMatch = getClassScheduleText(class_).match(/(?:^|\D)((?:[01]?\d|2[0-3]):[0-5]\d)(?:\D|$)/);
  if (!timeMatch) {
    return Number.POSITIVE_INFINITY;
  }
  const [hour, minute] = timeMatch[1].split(":").map(Number);
  return hour * 60 + minute;
}

export function prepareClassSearchCorpus(
  class_: ClassResponse | null | undefined,
): PreparedSearchCorpus {
  const record = asRecord(class_);
  const name = getTrimmedString(record?.name) ?? "";
  const displayName = getTrimmedString(record?.display_name) ?? name;
  const primaryLabel = getTrimmedString(record?.primary_label) ?? name;
  const secondaryLabel = getTrimmedString(record?.secondary_label);
  const type = isClassType(record?.type) ? record.type : null;
  const baseFee = getFiniteNumber(record?.base_fee);
  const billingCycleMonths = getFiniteNumber(record?.billing_cycle_months);
  const billingCycleWeeks = getFiniteNumber(record?.billing_cycle_weeks);

  return prepareSearchCorpus([
    name,
    displayName,
    primaryLabel,
    secondaryLabel,
    getClassTeacherNames(class_).join(" "),
    getClassScheduleSummary(class_) || null,
    getClassScheduleText(class_) || null,
    type,
    type ? formatClassType(type) : null,
    getClassBillingDurationLabel(class_) || null,
    getClassCategoryLabel(class_) || null,
    billingCycleMonths,
    billingCycleWeeks,
    baseFee === null ? null : formatCurrency(baseFee),
    getClassGroupInfoForRecord(class_).label || null,
    getTrimmedString(record?.start_date),
    getTrimmedString(record?.end_date),
    getTrimmedString(record?.effective_status),
    record?.grade_level === null || record?.grade_level === undefined
      ? null
      : `Khối ${record.grade_level}`,
    getFiniteNumber(record?.academic_year_start),
  ]);
}

export function prepareClassRecords(
  classes: readonly ClassResponse[] | null | undefined,
): PreparedClassRecord[] {
  if (!Array.isArray(classes)) {
    return [];
  }

  return classes.flatMap((candidate) => {
    if (!asRecord(candidate)) {
      return [];
    }
    return [{ class_: candidate, searchCorpus: prepareClassSearchCorpus(candidate) }];
  });
}

export function filterAndSortPreparedClasses(
  records: readonly PreparedClassRecord[] | null | undefined,
  filters: ClassFilters = {},
): ClassResponse[] {
  if (!Array.isArray(records)) {
    return [];
  }

  const matchesSearch = createPreparedSearchMatcher(filters.search);
  const selectedDay = getTrimmedString(filters.day);
  const selectedDuration = parsePositiveInteger(filters.courseDuration);
  const selectedType = isClassType(filters.type) ? filters.type : null;
  const selectedCategory = getTrimmedString(filters.category);
  const selectedStatus = getTrimmedString(filters.status);

  const safeRecords = records.flatMap((candidate) => {
    const record = asRecord(candidate);
    if (!record) {
      return [];
    }
    const class_ = record.class_;
    if (!asRecord(class_)) {
      return [];
    }
    const searchCorpus = isPreparedSearchCorpus(record.searchCorpus)
      ? record.searchCorpus
      : prepareClassSearchCorpus(class_ as ClassResponse);
    return [{ class_: class_ as ClassResponse, searchCorpus }];
  });

  return safeRecords
    .filter(({ class_, searchCorpus }) => {
      const record = asRecord(class_);
      if (!record || !matchesSearch(searchCorpus)) {
        return false;
      }
      if (selectedType && record.type !== selectedType) {
        return false;
      }
      if (selectedCategory && record.class_category !== selectedCategory) {
        return false;
      }
      if (selectedStatus && record.effective_status !== selectedStatus) {
        return false;
      }
      const recordWeeks = normalizeCourseBillingWeeks(
        getFiniteNumber(record.billing_cycle_weeks),
        getFiniteNumber(record.billing_cycle_months),
      );
      if (selectedDuration !== null && recordWeeks !== selectedDuration) {
        return false;
      }
      if (selectedDay && !classMatchesDay(class_, selectedDay)) {
        return false;
      }
      return true;
    })
    .map(({ class_ }) => class_)
    .sort((left, right) => compareClasses(left, right, selectedDay));
}

export function filterAndSortClasses(
  classes: readonly ClassResponse[] | null | undefined,
  filters: ClassFilters = {},
): ClassResponse[] {
  return filterAndSortPreparedClasses(prepareClassRecords(classes), filters);
}

function classMatchesDay(class_: ClassResponse, day: string): boolean {
  const slots = getClassScheduleSlots(class_);
  if (slots.length > 0) {
    return slots.some((slot) => slot.day === day);
  }
  const scheduleText = getClassScheduleText(class_);
  return Boolean(
    scheduleText && createPreparedSearchMatcher(day)(prepareSearchCorpus([scheduleText])),
  );
}

function compareClasses(left: ClassResponse, right: ClassResponse, selectedDay: string | null) {
  if (selectedDay) {
    const leftTime = getClassEarliestStartMinutes(left, selectedDay);
    const rightTime = getClassEarliestStartMinutes(right, selectedDay);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
  } else if (left.type !== right.type) {
    return left.type === "MONTHLY" ? -1 : 1;
  }

  const leftName = getTrimmedString(asRecord(left)?.name) ?? "";
  const rightName = getTrimmedString(asRecord(right)?.name) ?? "";
  const [leftKey] = getClassSortKey(leftName);
  const [rightKey] = getClassSortKey(rightName);
  if (leftKey !== rightKey) {
    return leftKey - rightKey;
  }
  const nameDifference = leftName.localeCompare(rightName, "vi");
  if (nameDifference !== 0) {
    return nameDifference;
  }
  return String(asRecord(left)?.id ?? "").localeCompare(String(asRecord(right)?.id ?? ""));
}

function compareScheduleSlots(left: ClassScheduleSlot, right: ClassScheduleSlot) {
  const dayDifference =
    (CLASS_DAY_ORDER.get(left.day) ?? Number.MAX_SAFE_INTEGER) -
    (CLASS_DAY_ORDER.get(right.day) ?? Number.MAX_SAFE_INTEGER);
  if (dayDifference !== 0) {
    return dayDifference;
  }
  return left.start.localeCompare(right.start) || left.end.localeCompare(right.end);
}

function getSafeStringList(
  value: unknown,
  listKey: "teacher_ids" | "teacher_names" | "assistant_ids" | "assistant_names",
  fallbackKey: "teacher_id" | "teacher_name" | "assistant_id" | "assistant_name",
): string[] {
  const record = asRecord(value);
  const list = Array.isArray(record?.[listKey]) ? record[listKey] : [];
  const normalized = list.flatMap((candidate) => {
    const text = getTrimmedString(candidate);
    return text ? [text] : [];
  });
  const fallback = getTrimmedString(record?.[fallbackKey]);
  return Array.from(new Set(normalized.length > 0 ? normalized : fallback ? [fallback] : []));
}

function readOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value.flatMap((candidate) => {
        const text = getTrimmedString(candidate);
        return text ? [text] : [];
      }),
    ),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isClassType(value: unknown): value is ClassType {
  return value === "MONTHLY" || value === "COURSE";
}

function isPreparedSearchCorpus(value: unknown): value is PreparedSearchCorpus {
  const record = asRecord(value);
  return (
    typeof record?.compact === "string" &&
    typeof record.digits === "string" &&
    typeof record.normalized === "string"
  );
}

function parsePositiveInteger(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
