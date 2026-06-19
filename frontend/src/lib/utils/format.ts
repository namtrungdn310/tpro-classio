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
      label: `Gói ${formatShortMonth(start)}-${formatShortMonth(end)}`,
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
