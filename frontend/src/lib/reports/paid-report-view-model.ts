import type {
  FeePaidReceiptRefundState,
  FeePaidReceiptSummary,
  FeePaidReceiptTimelineEvent,
  FeePaidReportSummary,
  FeePaymentMethod,
  FeePaymentOrigin,
} from "@/lib/types";

export const EMPTY_PAID_REPORT_SUMMARY: FeePaidReportSummary = {
  gross_amount: 0,
  refunded_amount: 0,
  net_amount: 0,
  receipt_count: 0,
  student_count: 0,
  bank_transfer_net_amount: 0,
  cash_net_amount: 0,
};

export const PAID_RECEIPT_REFUND_META: Record<
  FeePaidReceiptRefundState,
  { label: string; tone: "emerald" | "amber" | "rose" | "gray" }
> = {
  NONE: { label: "Đã nộp", tone: "emerald" },
  PARTIAL: { label: "Hoàn một phần", tone: "amber" },
  FULL: { label: "Đã hoàn hết", tone: "rose" },
  REVERSED: { label: "Đã hoàn tác", tone: "gray" },
};

export const PAID_RECEIPT_TIMELINE_META: Record<
  FeePaidReceiptTimelineEvent,
  { label: string; tone: "emerald" | "rose" | "sky" | "gray" }
> = {
  payment: { label: "Ghi nhận đã nộp", tone: "emerald" },
  refund: { label: "Hoàn học phí", tone: "rose" },
  refund_reversal: { label: "Hoàn tác hoàn phí", tone: "sky" },
  payment_reversal: { label: "Hoàn tác ghi nhận", tone: "gray" },
};

export function getPaidReceiptCode(paymentOperationId: string) {
  const compact = paymentOperationId.replace(/[^a-zA-Z0-9]/g, "");
  return `PT-${compact.slice(-8).toUpperCase().padStart(8, "0")}`;
}

export function normalizePaidReportSearch(value: string) {
  return value.trim().replace(/^PT[\s-]*/i, "").slice(0, 100);
}

export function getPaidReceiptActor(
  value: Pick<FeePaidReceiptSummary, "actor_name" | "actor_username">,
) {
  return value.actor_name || value.actor_username || "Dữ liệu lịch sử";
}

export function getPaidReceiptClassSummary(
  value: Pick<FeePaidReceiptSummary, "class_count" | "class_names">,
) {
  if (value.class_names.length === 0) {
    return "Lớp đã xoá";
  }
  if (value.class_names.length === 1) {
    return value.class_names[0];
  }
  const remaining = Math.max(
    value.class_count - 1,
    value.class_names.length - 1,
  );
  return `${value.class_names[0]} và ${remaining} lớp khác`;
}

export function getPaymentMethodLabel(value: FeePaymentMethod | null) {
  if (value === "bank_transfer") {
    return "Chuyển khoản";
  }
  if (value === "cash") {
    return "Tiền mặt";
  }
  return "Không xác định";
}

export function getPaymentOriginLabel(value: FeePaymentOrigin) {
  if (value === "pay2s") return "Pay2S tự động";
  if (value === "manual_early") return "Thu sớm thủ công";
  return "Ghi nhận thủ công";
}

export function getPaymentMethodDistribution(summary: FeePaidReportSummary) {
  const total = Math.max(summary.net_amount, 0);
  const bank = Math.max(summary.bank_transfer_net_amount, 0);
  const cash = Math.max(summary.cash_net_amount, 0);

  if (total === 0) {
    return { bankPercent: 0, cashPercent: 0 };
  }

  const bankPercent = Math.min(100, (bank / total) * 100);
  const cashPercent = Math.min(100 - bankPercent, (cash / total) * 100);
  return { bankPercent, cashPercent };
}
