export type FeeTab = "unpaid" | "paid";

export type UnpaidStage = "unnotified" | "notified";

export type FeeMutationAction = "notify" | "pay" | "refund" | "unpay" | "unnotify";

export type ClassFeeSummary = {
  id: string;
  name: string;
  totalAmount: number;
  paidStudentCount: number;
  unpaidStudentCount: number;
};

export type FeeSummaryMetrics = {
  grossCollected: number;
  netCollected: number;
  notified: number;
  outstanding: number;
  paid: number;
  refunded: number;
  recordCount: number;
  total: number;
  unnotified: number;
};
