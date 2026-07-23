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

export function formatBillingCycle(type: ClassType, billingCycleMonths: number): string {
  if (type === "MONTHLY") {
    return "Mỗi tháng";
  }

  return `${billingCycleMonths} tháng/lần`;
}

export type BillingPeriodOption = {
  key: string;
  label: string;
};

export function getAdjacentBillingPeriods(
  type: ClassType,
  billingCycleMonths: number,
  classStartDate?: string | null,
  referenceDate = new Date(),
): BillingPeriodOption[] {
  const cycleMonths = type === "MONTHLY" ? 1 : Math.max(1, billingCycleMonths);
  const anchor = getMonthStart(classStartDate ? new Date(classStartDate) : referenceDate);
  const reference = getMonthStart(referenceDate);
  const monthDistance =
    (reference.getFullYear() - anchor.getFullYear()) * 12 +
    reference.getMonth() -
    anchor.getMonth();
  const currentIndex = Math.floor(monthDistance / cycleMonths);

  return [-1, 0, 1].map((offset) => {
    const start = addMonths(anchor, (currentIndex + offset) * cycleMonths);
    const end = addMonths(start, cycleMonths - 1);

    if (type === "MONTHLY") {
      const key = toPeriodKey(start);
      return { key, label: formatPeriod(key) };
    }

    return {
      key: `${toPeriodKey(start)}_${toPeriodKey(end)}`,
      label: `Gói ${formatShortMonth(start)} - ${formatShortMonth(end)}`,
    };
  });
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatShortMonth(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
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

export function getCourseWeeks(billingCycleMonths: number): number {
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
