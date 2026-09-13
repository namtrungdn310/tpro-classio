"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useFinancialPrivacy } from "@/components/providers/financial-privacy-provider";
import {
  FINANCIAL_AMOUNT_MASK,
  formatFinancialAmount,
} from "@/lib/financial-privacy";
import { cn } from "@/lib/utils";

type FinancialAmountProps = Omit<ComponentPropsWithoutRef<"span">, "children" | "title"> & {
  amount: number | null | undefined;
  fallback?: string;
  prefix?: string;
};

export function FinancialAmount({
  amount,
  className,
  fallback = "—",
  prefix = "",
  ...props
}: FinancialAmountProps) {
  const { isFinancialPrivacyHidden } = useFinancialPrivacy();
  const displayValue = formatFinancialAmount(amount, isFinancialPrivacyHidden, { fallback, prefix });
  const isMasked = isFinancialPrivacyHidden && amount !== null && amount !== undefined;

  return (
    <span
      {...props}
      className={cn("tabular-nums", className)}
      data-financial-value="true"
      aria-label={isMasked ? "Số tiền đang được ẩn" : undefined}
      title={isMasked ? undefined : displayValue}
    >
      {isMasked ? FINANCIAL_AMOUNT_MASK : displayValue}
    </span>
  );
}
