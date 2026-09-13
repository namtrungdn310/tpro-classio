import type { ClassType } from "@/lib/types";

export function formatCurrency(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;
}

export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    return period;
  }

  return `Tháng ${Number(match[2])}/${match[1]}`;
}

export function formatDate(value: string | null | undefined, fallback = "—"): string {
  if (!value) {
    return fallback;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (dateOnlyMatch && !value.includes("T")) {
    return `${dateOnlyMatch[3]}/${dateOnlyMatch[2]}/${dateOnlyMatch[1]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = getVietnamDateTimeParts(date, false);
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = getVietnamDateTimeParts(date, true);
  return `${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`;
}

export function formatCompactDateTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("day")}/${getPart("month")}/${getPart("year")} · ${getPart("hour")}:${getPart("minute")}`;
}

export function formatClassType(type: ClassType): string {
  return type === "MONTHLY" ? "Theo tháng" : "Theo gói";
}

function getVietnamDateTimeParts(date: Date, includeTime: boolean) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          hourCycle: "h23" as const,
        }
      : {}),
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    day: getPart("day"),
    month: getPart("month"),
    year: getPart("year"),
    hour: getPart("hour"),
    minute: getPart("minute"),
  };
}

export function getCourseWeeks(
  billingCycleMonths: number,
  billingCycleWeeks?: number | null,
): number {
  if (billingCycleWeeks && billingCycleWeeks > 0) {
    return billingCycleWeeks;
  }
  if (billingCycleMonths === 2) {
    return 8;
  }
  if (billingCycleMonths === 6) {
    return 24;
  }
  if (billingCycleMonths === 12) {
    return 48;
  }
  return 12;
}

/** Add `months` calendar months to an ISO date string (timezone-safe). */
export function addMonthsToIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = totalMonths % 12;
  const lastDay = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(d, lastDay);
  return `${String(newYear).padStart(4, "0")}-${String(newMonth + 1).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
}

/** Whole months between two ISO dates, rounded up (timezone-safe). */
export function differenceInIsoMonths(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed > sd) months += 1;
  return Math.max(1, months);
}
