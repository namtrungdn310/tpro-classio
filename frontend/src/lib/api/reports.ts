import { apiClient } from "@/lib/api/client";
import {
  feePaidReceiptDetailSchema,
  feePaidReceiptListSchema,
} from "@/lib/schemas/reports";
import type {
  FeePaidReceiptDetail,
  FeePaidReceiptListResponse,
  FeePaidReceiptRefundState,
  FeePaymentMethod,
} from "@/lib/types";
import { normalizePaidReportSearch } from "@/lib/reports/paid-report-view-model";

export type FeePaidReceiptFilters = {
  period?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  payment_method?: FeePaymentMethod | "";
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
