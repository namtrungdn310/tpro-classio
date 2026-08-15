const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function differenceInIsoDays(start: string, end: string): number {
  if (!ISO_DATE_PATTERN.test(start) || !ISO_DATE_PATTERN.test(end)) return 0;
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(startYear, startMonth - 1, startDay)) /
      86_400_000,
  );
}

export type DerivedCoursePackageSummary = {
  fullPackages: number;
  remainingDays: number;
  totalDays: number;
};

/**
 * R6: end date is independent of the billing cadence. The package count is a
 * DERIVED preview only (cadence + chosen end date); it never computes or
 * constrains the end date. Returns null when inputs are incomplete.
 */
export function getDerivedCoursePackageSummary(
  startDate: string,
  endDate: string,
  billingCycleWeeks: number | null | undefined,
): DerivedCoursePackageSummary | null {
  if (
    !ISO_DATE_PATTERN.test(startDate) ||
    !ISO_DATE_PATTERN.test(endDate) ||
    !billingCycleWeeks ||
    billingCycleWeeks < 1
  ) {
    return null;
  }
  const totalDays = differenceInIsoDays(startDate, endDate);
  const cycleDays = billingCycleWeeks * 7;
  if (totalDays <= 0) return null;
  return {
    fullPackages: Math.floor(totalDays / cycleDays),
    remainingDays: totalDays % cycleDays,
    totalDays,
  };
}
