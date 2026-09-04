import { apiClient } from "@/lib/api/client";
import {
  feeBatchActionResponseSchema,
  feeRefundBatchResponseSchema,
  feeRefundReversalResponseSchema,
  feeMessageTemplatesResponseSchema,
  feePeriodListResponseSchema,
  feeRecordListResponseSchema,
  feePaymentCapabilitiesSchema,
  feeTransactionBatchResponseSchema,
  paymentRequestListResponseSchema,
  paymentRequestResponseSchema,
  billingReviewListResponseSchema,
  billingReviewSchema,
} from "@/lib/schemas/fees";
import { verifyFeeTransactionBatch } from "@/lib/fees/transaction-integrity";
import type {
  FeeBatchActionResponse,
  FeeNotificationState,
  FeeMessageTemplatesResponse,
  FeeMessageTemplatesUpdate,
  FeeMessageDraft,
  FeePaymentMethod,
  FeePeriodListResponse,
  FeeRecordListResponse,
  FeePaymentCapabilities,
  FeeRefundBatchResponse,
  FeeRefundRequest,
  FeeRefundReversalRequest,
  FeeRefundReversalResponse,
  FeeTransactionBatchResponse,
  FeeUnpayTargetState,
  PaymentRequestResponse,
  PaymentRequestShareChannel,
  PaymentRequestListResponse,
  PaymentRequestStatus,
  BillingReview,
  BillingReviewListResponse,
} from "@/lib/types";

export async function getBillingReviews(): Promise<BillingReviewListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/billing-reviews", {
    params: { state: "PENDING" },
  });
  return billingReviewListResponseSchema.parse(data);
}

export async function resolveBillingReview(
  reviewId: string,
  payload: {
    decision: "CONFIRM" | "WAIVE_CHARGE";
    fee_record_ids?: string[];
    reason?: string;
  },
): Promise<BillingReview> {
  const { data } = await apiClient.post<unknown>(
    `/fees/billing-reviews/${reviewId}/resolve`,
    { ...payload, request_id: crypto.randomUUID() },
  );
  return billingReviewSchema.parse(data);
}

type GetFeesParams = {
  period: string;
  class_id?: string;
  state?: FeeNotificationState | "";
  include_future?: boolean;
};

export async function getFeePeriods(): Promise<FeePeriodListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/periods");
  return feePeriodListResponseSchema.parse(data);
}

export async function getFeePaymentCapabilities(): Promise<FeePaymentCapabilities> {
  const { data } = await apiClient.get<unknown>("/fees/payment-capabilities");
  return feePaymentCapabilitiesSchema.parse(data);
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

export async function resetFeeMessageTemplates(version: number): Promise<FeeMessageTemplatesResponse> {
  const { data } = await apiClient.post<unknown>("/fees/message-templates/reset", { version });
  return feeMessageTemplatesResponseSchema.parse(data);
}

export async function saveFeeMessageDraft(
  recordIds: string[],
  kind: "reminder" | "received",
  message: string,
  expectedRevision?: number,
  sourceFingerprint?: string,
): Promise<FeeMessageDraft> {
  const current =
    expectedRevision === undefined || sourceFingerprint === undefined
      ? await getFeeMessageDraft(recordIds, kind)
      : null;
  const { data } = await apiClient.put<FeeMessageDraft>("/fees/actions/message-draft", {
    record_ids: recordIds,
    kind,
    message,
    expected_revision: expectedRevision ?? current?.revision ?? 0,
    source_fingerprint: sourceFingerprint ?? current?.source_fingerprint,
  });
  return data;
}


export async function getFeeMessageDraft(
  recordIds: string[],
  kind: "reminder" | "received",
): Promise<FeeMessageDraft> {
  const { data } = await apiClient.post<FeeMessageDraft>("/fees/actions/message-draft/preview", {
    record_ids: recordIds,
    kind,
  });
  return data;
}

export async function getFeeRecords(params: GetFeesParams): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.get<unknown>("/fees", {
    params: {
      period: params.period,
      class_id: params.class_id || undefined,
      state: params.state || undefined,
      include_future: params.include_future || undefined,
    },
  });
  return feeRecordListResponseSchema.parse(data);
}

export async function getOutstandingFeeRecords(): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/outstanding");
  return feeRecordListResponseSchema.parse(data);
}

export async function getUpcomingFeeRecords(
  classId?: string,
): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/upcoming", {
    params: { class_id: classId || undefined, limit: 100 },
  });
  return feeRecordListResponseSchema.parse(data);
}

export async function payFeeRecordsEarly(
  recordIds: string[],
  paymentMethod: FeePaymentMethod,
  settlementAccountId?: string,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/early-paid", {
    record_ids: recordIds,
    payment_method: paymentMethod,
    settlement_account_id: settlementAccountId || undefined,
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function createEarlyPaymentRequest(
  recordIds: string[],
): Promise<PaymentRequestResponse> {
  const { data } = await apiClient.post<unknown>("/fees/payment-requests", {
    record_ids: recordIds,
  });
  return paymentRequestResponseSchema.parse(data);
}

export async function createPay2SCollectionLink(
  requestId: string,
): Promise<PaymentRequestResponse> {
  const { data } = await apiClient.post<unknown>(
    `/fees/payment-requests/${requestId}/collection-link`,
  );
  return paymentRequestResponseSchema.parse(data);
}

export async function sharePaymentRequest(
  requestId: string,
  channel: PaymentRequestShareChannel,
): Promise<PaymentRequestResponse> {
  const { data } = await apiClient.post<unknown>(
    `/fees/payment-requests/${requestId}/share`,
    { channel, idempotency_key: crypto.randomUUID() },
  );
  return paymentRequestResponseSchema.parse(data);
}

export async function revokePaymentRequest(
  requestId: string,
  reason = "Admin hủy yêu cầu thanh toán",
): Promise<PaymentRequestResponse> {
  const { data } = await apiClient.post<unknown>(
    `/fees/payment-requests/${requestId}/revoke`,
    { reason },
  );
  return paymentRequestResponseSchema.parse(data);
}

export async function getPaymentRequests(
  requestStatus?: PaymentRequestStatus,
): Promise<PaymentRequestListResponse> {
  const { data } = await apiClient.get<unknown>("/fees/payment-requests", {
    params: { status: requestStatus || undefined, limit: 100 },
  });
  return paymentRequestListResponseSchema.parse(data);
}

export async function syncFeeRecords(period: string): Promise<FeeRecordListResponse> {
  const { data } = await apiClient.post<unknown>("/fees/sync", null, {
    params: { period },
  });
  return feeRecordListResponseSchema.parse(data);
}

export async function notifyFeeRecords(
  recordIds: string[],
  draft: FeeMessageDraft,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/notify", {
    record_ids: recordIds,
    draft_revision: draft.revision,
    source_fingerprint: draft.source_fingerprint,
    channel: "zalo_manual",
  });
  return feeBatchActionResponseSchema.parse(data);
}

export async function payFeeRecords(
  recordIds: string[],
  paymentMethod: FeePaymentMethod,
  settlementAccountId?: string,
): Promise<FeeBatchActionResponse> {
  const { data } = await apiClient.patch<unknown>("/fees/actions/paid", {
    record_ids: recordIds,
    payment_method: paymentMethod,
    settlement_account_id: settlementAccountId || undefined,
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
