import { formatCurrency } from "@/lib/utils/format";

export const FINANCIAL_AMOUNT_MASK = "••••••••";

const STORAGE_PREFIX = "tpro:financial-privacy";

export function getFinancialPrivacyStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function parseFinancialPrivacyValue(value: string | null): boolean {
  return value === "hidden";
}

export function formatFinancialAmount(
  amount: number | null | undefined,
  isHidden: boolean,
  { fallback = "—", prefix = "" }: { fallback?: string; prefix?: string } = {},
): string {
  if (amount === null || amount === undefined) {
    return fallback;
  }
  if (isHidden) {
    return FINANCIAL_AMOUNT_MASK;
  }
  return `${prefix}${formatCurrency(Math.abs(amount))}`;
}
