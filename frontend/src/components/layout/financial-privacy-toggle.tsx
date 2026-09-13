"use client";

import { RiEyeLine, RiEyeOffLine } from "react-icons/ri";
import { useFinancialPrivacy } from "@/components/providers/financial-privacy-provider";
import { Button } from "@/components/ui/button";

export function FinancialPrivacyToggle() {
  const {
    canControlFinancialPrivacy,
    isFinancialPrivacyHidden,
    isFinancialPrivacyReady,
    toggleFinancialPrivacy,
  } = useFinancialPrivacy();

  if (!canControlFinancialPrivacy || !isFinancialPrivacyReady) {
    return null;
  }

  const actionLabel = isFinancialPrivacyHidden ? "Hiện số tiền" : "Ẩn số tiền";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={actionLabel}
      aria-pressed={isFinancialPrivacyHidden}
      title={actionLabel}
      onClick={toggleFinancialPrivacy}
      className={isFinancialPrivacyHidden ? "border-primary/15 bg-primary-soft text-primary hover:bg-primary-soft/80 hover:text-primary" : undefined}
    >
      {isFinancialPrivacyHidden ? <RiEyeOffLine /> : <RiEyeLine />}
    </Button>
  );
}
