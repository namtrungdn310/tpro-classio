import type { ClassResponse, ClassScheduleSlot, ClassType } from "@/lib/types";
import { getClassGroupInfo, getClassSortKey } from "@/lib/utils/class-groups";
import { formatClassType, formatCurrency } from "@/lib/utils/format";
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

export const COURSE_DURATION_OPTIONS = [
  { label: "8 tuần", months: 2, weeks: 8 },
  { label: "12 tuần", months: 3, weeks: 12 },
  { label: "24 tuần", months: 6, weeks: 24 },
  { label: "48 tuần", months: 12, weeks: 48 },
] as const;

export type ClassFilters = {
  search?: string | null;
  type?: ClassType | "" | null;
  courseDuration?: string | number | null;
  day?: string | null;
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
const COURSE_MONTHS = new Set<number>(COURSE_DURATION_OPTIONS.map((option) => option.months));
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function getClassTeacherIds(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "teacher_ids", "teacher_id");
}

export function getClassTeacherNames(class_: ClassResponse | null | undefined): string[] {
  return getSafeStringList(class_, "teacher_names", "teacher_name");
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

    return [{ day: day as ClassScheduleSlot["day"], start, end }];
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
  return typeof value === "number" && Number.isInteger(value) && COURSE_MONTHS.has(value)
    ? value
    : 3;
}

export function getCourseDurationLabel(value: number | null | undefined): string {
  const normalized = normalizeCourseBillingMonths(value);
  return COURSE_DURATION_OPTIONS.find((option) => option.months === normalized)?.label ?? "12 tuần";
}

export function getClassBillingDurationLabel(
  class_: ClassResponse | null | undefined,
): string {
  const record = asRecord(class_);
  if (record?.type === "MONTHLY") {
    return "1 tháng";
  }
  return getCourseDurationLabel(getFiniteNumber(record?.billing_cycle_months));
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
  const type = isClassType(record?.type) ? record.type : null;
  const baseFee = getFiniteNumber(record?.base_fee);
  const billingCycleMonths = getFiniteNumber(record?.billing_cycle_months);

  return prepareSearchCorpus([
    name,
    ...getClassTeacherNames(class_),
    getClassScheduleSummary(class_),
    getClassScheduleText(class_),
    type,
    type ? formatClassType(type) : null,
    getClassBillingDurationLabel(class_),
    billingCycleMonths,
    baseFee === null ? null : formatCurrency(baseFee),
    getClassGroupInfo(name).label,
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
      if (selectedDuration !== null && record.billing_cycle_months !== selectedDuration) {
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
  listKey: "teacher_ids" | "teacher_names",
  fallbackKey: "teacher_id" | "teacher_name",
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
