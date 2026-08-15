const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string): [number, number, number] | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const parts = value.split("-").map(Number) as [number, number, number];
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return parts;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function addMonthsEomClamped(value: string, months: number): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  const sourceLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonthIndex = monthIndex % 12;
  const targetLastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  const targetDay = day === sourceLastDay ? targetLastDay : Math.min(day, targetLastDay);
  return formatUtcDate(new Date(Date.UTC(targetYear, targetMonthIndex, targetDay)));
}

/**
 * UI-only shortcut. The returned date is a suggestion; the class end date
 * remains an independently editable domain value.
 */
export function getSuggestedClassEndDate({
  startDate,
  type,
  count,
  billingCycleWeeks,
}: {
  startDate: string;
  type: "MONTHLY" | "COURSE";
  count: number;
  billingCycleWeeks?: number | null;
}): string | null {
  if (!Number.isInteger(count) || count < 1) return null;
  if (type === "MONTHLY") {
    const boundary = addMonthsEomClamped(startDate, count);
    return boundary ? addDays(boundary, 1) : null;
  }
  if (!billingCycleWeeks || !Number.isInteger(billingCycleWeeks) || billingCycleWeeks < 1) {
    return null;
  }
  return addDays(startDate, count * billingCycleWeeks * 7);
}

export function getExactEndDateShortcutCount({
  startDate,
  endDate,
  type,
  billingCycleWeeks,
  maxCount = 1_000,
}: {
  startDate: string;
  endDate: string;
  type: "MONTHLY" | "COURSE";
  billingCycleWeeks?: number | null;
  maxCount?: number;
}): number | null {
  for (let count = 1; count <= maxCount; count += 1) {
    const candidate = getSuggestedClassEndDate({
      startDate,
      type,
      count,
      billingCycleWeeks,
    });
    if (candidate === endDate) return count;
    if (candidate && candidate > endDate) return null;
  }
  return null;
}

/** Derive the package duration shown in the form from the two shortcut inputs. */
export function getCourseShortcutTotalWeeks(
  billingCycleWeeks: number | null | undefined,
  packageCount: string | number | null | undefined,
): number | null {
  const count = typeof packageCount === "string" ? Number(packageCount) : packageCount;
  if (
    !Number.isInteger(billingCycleWeeks) ||
    Number(billingCycleWeeks) < 1 ||
    !Number.isInteger(count) ||
    Number(count) < 1
  ) {
    return null;
  }
  return Number(billingCycleWeeks) * Number(count);
}
