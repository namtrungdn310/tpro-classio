import { apiClient } from "@/lib/api/client";
import {
  feeOperationListSchema,
  feeOperationSchema,
  feePaidReceiptDetailSchema,
  feePaidReceiptListSchema,
  paymentReconciliationItemSchema,
  paymentReconciliationListSchema,
} from "@/lib/schemas/reports";
import type {
  FeeOperation,
  FeeOperationAction,
  FeeOperationListResponse,
  FeePaidReceiptDetail,
  FeePaidReceiptListResponse,
  FeePaidReceiptRefundState,
  FeePaymentMethod,
  PaymentReconciliationItem,
  PaymentReconciliationListResponse,
  PaymentReconciliationResolveAction,
} from "@/lib/types";
import { normalizePaidReportSearch } from "@/lib/reports/paid-report-view-model";

export type FeePaidReceiptFilters = {
  period?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  payment_method?: FeePaymentMethod | "";
  payment_origin?: "manual" | "manual_early" | "pay2s" | "";
  refund_state?: FeePaidReceiptRefundState | "";
  cursor?: string;
  limit?: number;
};

export async function getFeePaidReceipts(
  filters: FeePaidReceiptFilters = {},
  signal?: AbortSignal,
): Promise<FeePaidReceiptListResponse> {
  const { data } = await apiClient.get<unknown>("/reports/fees/paid", {
    signal,
    params: {
      ...filters,
      period: filters.period || undefined,
      q: filters.q ? normalizePaidReportSearch(filters.q) || undefined : undefined,
      payment_method: filters.payment_method || undefined,
      payment_origin: filters.payment_origin || undefined,
      refund_state: filters.refund_state || undefined,
      cursor: filters.cursor || undefined,
    },
  });
  return feePaidReceiptListSchema.parse(data);
}

export async function getFeePaidReceipt(
  receiptId: string,
  signal?: AbortSignal,
): Promise<FeePaidReceiptDetail> {
  const { data } = await apiClient.get<unknown>(
    `/reports/fees/paid/${encodeURIComponent(receiptId)}`,
    { signal },
  );
  return feePaidReceiptDetailSchema.parse(data);
}

export type FeeOperationFilters = {
  action?: FeeOperationAction | "";
  period?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  cursor?: string;
  limit?: number;
};

export async function getFeeOperations(
  filters: FeeOperationFilters = {},
  signal?: AbortSignal,
): Promise<FeeOperationListResponse> {
  const { data } = await apiClient.get<unknown>("/reports/fees/operations", {
    signal,
    params: {
      ...filters,
      action: filters.action || undefined,
      period: filters.period || undefined,
      q: filters.q ? normalizePaidReportSearch(filters.q) || undefined : undefined,
      cursor: filters.cursor || undefined,
    },
  });
  return feeOperationListSchema.parse(data);
}

export async function getFeeOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<FeeOperation> {
  const { data } = await apiClient.get<unknown>(
    `/reports/fees/operations/${encodeURIComponent(operationId)}`,
    { signal },
  );
  return feeOperationSchema.parse(data);
}

export async function getPaymentReconciliation(
  status = "REVIEW",
  signal?: AbortSignal,
): Promise<PaymentReconciliationListResponse> {
  const { data } = await apiClient.get<unknown>("/reports/fees/reconciliation", {
    signal,
    params: { status, limit: 100 },
  });
  return paymentReconciliationListSchema.parse(data);
}

export async function resolvePaymentReconciliation(
  queueId: string,
  payload: {
    action: PaymentReconciliationResolveAction;
    payment_request_id?: string | null;
    reason: string;
  },
): Promise<PaymentReconciliationItem> {
  const { data } = await apiClient.post<unknown>(
    `/reports/fees/reconciliation/${encodeURIComponent(queueId)}/resolve`,
    payload,
  );
  return paymentReconciliationItemSchema.parse(data);
}
