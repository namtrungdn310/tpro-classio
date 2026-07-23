import { apiClient } from "@/lib/api/client";
import {
  feeBatchActionResponseSchema,
  feeRefundBatchResponseSchema,
  feeRefundReversalResponseSchema,
  feeMessageTemplatesResponseSchema,
  feePeriodListResponseSchema,
  feeRecordListResponseSchema,
  feeTransactionListResponseSchema,
  feeTransactionBatchResponseSchema,
} from "@/lib/schemas/fees";
import {
  verifyFeeTransactionBatch,
  verifyFeeTransactionHistory,
} from "@/lib/fees/transaction-integrity";
import type {
  FeeBatchActionResponse,
  FeeNotificationState,
  FeeMessageTemplatesResponse,
  FeeMessageTemplatesUpdate,
  FeePaymentMethod,
  FeePeriodListResponse,
  FeeRecordListResponse,
  FeeRefundBatchResponse,
  FeeRefundRequest,
  FeeRefundReversalRequest,
  FeeRefundReversalResponse,
  FeeTransactionListResponse,
  FeeTransactionBatchResponse,
  FeeUnpayTargetState,
} from "@/lib/types";

type GetFeesParams = {
  period: string;
  class_id?: string;
  state?: FeeNotificationState | "";
};

export async function getFeePeriods(): Promise<FeePeriodListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/periods");
  return feePeriodListResponseSchema.parse(data);
}

export async function getFeeMessageTemplates(): Promise<FeeMessageTemplatesResponse> {
  const { data } = await apiClient.get<unknown>("/fees/message-templates");
  return feeMessageTemplatesResponseSchema.parse(data);
}

export async function updateFeeMessageTemplates(
  payload: FeeMessageTemplatesUpdate,
): Promise<FeeMessageTemplatesResponse> {
  const { data } = await apiClient.put<unknown>("/fees/message-templates", payload);
  return feeMessageTemplatesResponseSchema.parse(data);
}

export async function getFeeRecords(params: GetFeesParams): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.get<unknown>("/fees", {
    params: {
      period: params.period,
      class_id: params.class_id || undefined,
      state: params.state || undefined,
    },
  });
  return feeRecordListResponseSchema.parse(data);
}

export async function syncFeeRecords(period: string): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.post<unknown>("/fees/sync", null, {
    params: { period },
  });
  return feeRecordListResponseSchema.parse(data);
}

export async function notifyFeeRecords(
  recordIds: string[],
  message: string,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/notify", {
    record_ids: recordIds,
    message,
    channel: "zalo_manual",
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function payFeeRecords(
  recordIds: string[],
  paymentMethod: FeePaymentMethod,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/paid", {
    record_ids: recordIds,
    payment_method: paymentMethod,
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function unpayFeeRecords(
  recordIds: string[],
  targetNotificationState: FeeUnpayTargetState,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/unpaid", {
    record_ids: recordIds,
    target_notification_state: targetNotificationState,
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function unnotifyFeeRecords(recordIds: string[]): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/unnotify", {
    record_ids: recordIds,
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function refundFeeRecords(
  payload: FeeRefundRequest,
): Promise<FeeRefundBatchResponse> {
  const { data } = await apiClient.post<unknown>("/fees/actions/refund", payload);
  const result = feeRefundBatchResponseSchema.parse(data);
  if (result.receipt.request_id !== payload.request_id) {
    throw new Error("Biên nhận hoàn phí không khớp với yêu cầu vừa gửi.");
  }
  return result;
}

export async function getFeeTransactions(
  feeRecordId: string,
): Promise<FeeTransactionListResponse> {
  const { data } = await apiClient.get<unknown>(`/fees/${feeRecordId}/transactions`);
  return verifyFeeTransactionHistory(
    feeTransactionListResponseSchema.parse(data),
    feeRecordId,
  );
}

export async function getFeeTransactionBatch(
  feeRecordIds: string[],
): Promise<FeeTransactionBatchResponse> {
  const { data } = await apiClient.post<unknown>("/fees/transactions/batch", {
    record_ids: feeRecordIds,
  });
  return verifyFeeTransactionBatch(
    feeTransactionBatchResponseSchema.parse(data),
    feeRecordIds,
  );
}

export async function reverseFeeRefund(
  payload: FeeRefundReversalRequest,
): Promise<FeeRefundReversalResponse> {
  const { data } = await apiClient.post<unknown>(
    "/fees/actions/refund-reversal",
    payload,
  );
  const result = feeRefundReversalResponseSchema.parse(data);
  if (result.transaction.request_id !== payload.request_id) {
    throw new Error("Giao dịch sửa hoàn phí không khớp với yêu cầu vừa gửi.");
  }
  return result;
}
