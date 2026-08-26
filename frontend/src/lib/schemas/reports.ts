import { z } from "zod";

export const feeOperationActionSchema = z.enum([
  "notify",
  "unnotify",
  "payment",
  "payment_reversal",
  "refund",
  "refund_reversal",
  "sync",
  "template_update",
]);

const nullableUuid = z.string().uuid().nullable();
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const signedAmount = z.number().int().safe();

export const feeOperationItemSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().positive(),
  fee_record_id: nullableUuid,
  enrollment_id: nullableUuid,
  student_id: nullableUuid,
  student_code: z.string().regex(/^TP\d{9}$/).nullable(),
  student_name: z.string().nullable(),
  class_id: nullableUuid,
  class_name: z.string().nullable(),
  period: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  state_before: z.string().nullable(),
  state_after: z.string().nullable(),
  amount_before: signedAmount.nullable(),
  amount_after: signedAmount.nullable(),
  amount_delta: signedAmount,
  due_date_before: nullableDate,
  due_date_after: nullableDate,
  payment_method: z.enum(["bank_transfer", "cash"]).nullable(),
  notification_channel: z.string().nullable(),
  message: z.string().nullable(),
  reason: z.string().nullable(),
  payment_id: nullableUuid,
  related_payment_id: nullableUuid,
});

export const feeOperationSchema = z.object({
  id: z.string().uuid(),
  sequence_no: z.number().int().nonnegative(),
  action: feeOperationActionSchema,
  origin: z.enum(["application", "migration", "system"]),
  request_id: nullableUuid,
  period: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occurred_at: z.string().datetime({ offset: true }),
  actor_user_id: nullableUuid,
  actor_name: z.string().nullable(),
  actor_username: z.string().nullable(),
  actor_role: z.string().nullable(),
  item_count: z.number().int().nonnegative(),
  total_amount: signedAmount,
  items: z.array(feeOperationItemSchema),
});

export const feeOperationListSchema = z.object({
  operations: z.array(feeOperationSchema),
  next_cursor: z.string().nullable(),
  summary: z.object({
    operation_count: z.number().int().nonnegative(),
    affected_item_count: z.number().int().nonnegative(),
    financial_net_change: signedAmount,
  }),
  history_complete_from: z.string().datetime({ offset: true }).nullable(),
});

export const feePaidReceiptRefundStateSchema = z.enum([
  "NONE",
  "PARTIAL",
  "FULL",
  "REVERSED",
]);

export const feePaidReceiptTimelineEventSchema = z.enum([
  "payment",
  "refund",
  "refund_reversal",
  "payment_reversal",
]);

const paymentMethodSchema = z.enum(["bank_transfer", "cash"]);
const paymentOriginSchema = z.enum(["manual", "manual_early", "pay2s"]);
const nonnegativeAmount = z.number().int().safe().nonnegative();
const paidReceiptActorSchema = {
  actor_name: z.string().nullable(),
  actor_username: z.string().nullable(),
  actor_role: z.string().nullable(),
};

export const feePaidReceiptSummarySchema = z.object({
  receipt_id: z.string().min(1),
  payment_operation_id: z.string().uuid(),
  student_id: nullableUuid,
  student_code: z.string().nullable().default(null),
  student_name: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paid_at: z.string().datetime({ offset: true }),
  payment_method: paymentMethodSchema,
  payment_origin: paymentOriginSchema,
  settlement_account_id: nullableUuid.optional().default(null),
  settlement_bank_name: z.string().nullable().optional().default(null),
  settlement_account_number: z.string().nullable().optional().default(null),
  settlement_account_name: z.string().nullable().optional().default(null),
  gross_amount: nonnegativeAmount,
  refunded_amount: nonnegativeAmount,
  net_amount: nonnegativeAmount,
  refund_state: feePaidReceiptRefundStateSchema,
  class_count: z.number().int().positive(),
  class_names: z.array(z.string().min(1)),
  ...paidReceiptActorSchema,
}).strict();

export const feePaidReportSummarySchema = z.object({
  gross_amount: nonnegativeAmount,
  refunded_amount: nonnegativeAmount,
  net_amount: nonnegativeAmount,
  receipt_count: z.number().int().nonnegative(),
  student_count: z.number().int().nonnegative(),
  bank_transfer_net_amount: nonnegativeAmount,
  cash_net_amount: nonnegativeAmount,
}).strict();

export const feePaidReceiptAllocationSchema = z.object({
  fee_record_id: nullableUuid,
  enrollment_id: nullableUuid,
  class_id: nullableUuid,
  class_name: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  gross_amount: nonnegativeAmount,
  refunded_amount: nonnegativeAmount,
  net_amount: nonnegativeAmount,
}).strict();

export const feePaidReceiptTimelineItemSchema = z.object({
  id: z.string().uuid(),
  event: feePaidReceiptTimelineEventSchema,
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occurred_at: z.string().datetime({ offset: true }),
  amount_delta: signedAmount,
  payment_method: paymentMethodSchema,
  payment_origin: paymentOriginSchema,
  settlement_account_id: nullableUuid.optional().default(null),
  settlement_bank_name: z.string().nullable().optional().default(null),
  settlement_account_number: z.string().nullable().optional().default(null),
  ...paidReceiptActorSchema,
  reason: z.string().nullable(),
}).strict();

export const feePaidReceiptDetailSchema = feePaidReceiptSummarySchema.extend({
  allocations: z.array(feePaidReceiptAllocationSchema),
  timeline: z.array(feePaidReceiptTimelineItemSchema),
});

export const feePaidReceiptListSchema = z.object({
  receipts: z.array(feePaidReceiptSummarySchema),
  next_cursor: z.string().nullable(),
  summary: feePaidReportSummarySchema,
}).strict();

export const paymentReconciliationItemSchema = z.object({
  id: z.string().uuid(),
  delivery_id: z.string().uuid(),
  status: z.enum(["PENDING", "PROCESSING", "POSTED", "REVIEW", "DEAD"]),
  review_reason: z.string().nullable(),
  resolution: z.string().nullable(),
  payment_request_id: nullableUuid,
  provider_transaction_id: z.string().nullable(),
  source: z.string().nullable(),
  bank_account_id: nullableUuid,
  bank_name: z.string().nullable(),
  account_number: z.string().nullable(),
  transfer_type: z.string().nullable(),
  amount: signedAmount.nullable(),
  content: z.string().nullable(),
  transaction_date: z.string().nullable(),
  result_code: z.string().nullable(),
  provider_message: z.string().nullable(),
  received_at: z.string().datetime({ offset: true }),
  resolved_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const paymentReconciliationListSchema = z.object({
  items: z.array(paymentReconciliationItemSchema),
  review_count: z.number().int().nonnegative(),
}).strict();
