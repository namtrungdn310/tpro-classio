import { z } from "zod";
import { feeMessageTemplatesResponseSchema } from "@/lib/fees/message-templates";

export { feeMessageTemplatesResponseSchema };

const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const feeListPeriodSchema = z.union([
  periodSchema,
  z.literal("upcoming"),
  z.literal("outstanding"),
]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine(isCalendarDate, "Ngày không hợp lệ");

const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  )
  .refine(
    (value) =>
      isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)),
    "Thời điểm không hợp lệ",
  );

const amountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const notificationStateSchema = z.enum([
  "UNNOTIFIED",
  "NOTIFIED_UNPAID",
  "PAID",
]);
const feeStatusSchema = z.enum(["UNPAID", "PAID"]);
const refundStateSchema = z.enum(["NONE", "PARTIAL", "FULL"]);
const notificationChannelSchema = z.enum(["zalo_manual", "zalo_copy"]);

export const feeRecordResponseSchema = z
  .object({
    id: z.string().uuid(),
    enrollment_id: z.string().uuid(),
    student_id: z.string().uuid(),
    student_code: z.string().regex(/^TP\d{9}$/).nullable().default(null),
    student_status: z.enum(["active", "inactive", "archived"]).nullable().default(null),
    student_name: z.string().min(1),
    class_id: z.string().uuid(),
    class_name: z.string().min(1),
    class_type: z.enum(["MONTHLY", "COURSE"]),
    billing_cycle_months: z.number().int().min(1).max(24),
    billing_cycle_weeks: z
      .number()
      .int()
      .min(1)
      .max(32_767)
      .nullable()
      .default(null),
    student_phone: z.string().nullable(),
    student_zalo: z.string().nullable(),
    student_contact_hidden: z.boolean(),
    parent_phone: z.string().nullable(),
    parent_zalo: z.string().nullable(),
    parent_contact_hidden: z.boolean(),
    period: periodSchema,
    enrollment_date: isoDateSchema.nullable(),
    due_date: isoDateSchema.nullable(),
    cycle_no: z.number().int().nonnegative().nullable().optional(),
    base_due_date: isoDateSchema.nullable().optional(),
    adjusted_due_date: isoDateSchema.nullable().optional(),
    coverage_start: isoDateSchema.nullable().optional(),
    coverage_end: isoDateSchema.nullable().optional(),
    origin: z.string().max(80).nullable().optional(),
    requires_review: z.boolean().default(false),
    billing_review_id: z.string().uuid().nullable().default(null),
    is_final_cycle: z.boolean().default(false),
    final_cycle_reason: z.string().nullable().default(null),
    base_amount: amountSchema,
    discount_amount: amountSchema,
    final_amount: amountSchema,
    status: feeStatusSchema,
    paid_amount: amountSchema.nullable(),
    paid_date: isoDateSchema.nullable(),
    refunded_amount: amountSchema,
    refundable_amount: amountSchema,
    net_collected_amount: amountSchema,
    refund_state: refundStateSchema,
    notified_at: isoDateTimeSchema.nullable(),
    notification_channel: notificationChannelSchema.nullable(),
    notification_message: z.string().min(1).max(2_000).nullable(),
    notification_state: notificationStateSchema,
  })
  .superRefine((record, context) => {
    if (
      (record.student_contact_hidden &&
        (record.student_phone !== null || record.student_zalo !== null)) ||
      (!record.student_contact_hidden &&
        (record.student_phone === null) !== (record.student_zalo === null))
    ) {
      addIssue(
        context,
        ["student_phone"],
        "Thông tin liên hệ học viên không đồng nhất",
      );
    }

    if (
      (record.parent_contact_hidden &&
        (record.parent_phone !== null || record.parent_zalo !== null)) ||
      (!record.parent_contact_hidden &&
        (record.parent_phone === null) !== (record.parent_zalo === null))
    ) {
      addIssue(
        context,
        ["parent_phone"],
        "Thông tin liên hệ phụ huynh không đồng nhất",
      );
    }

    if (record.discount_amount > record.base_amount) {
      addIssue(
        context,
        ["discount_amount"],
        "Mức giảm không được vượt học phí gốc",
      );
    }

    if (record.final_amount > record.base_amount) {
      addIssue(
        context,
        ["final_amount"],
        "Học phí cuối cùng không được vượt học phí gốc",
      );
    }

    const hasNotification = record.notified_at !== null;
    const hasAnyNotificationMetadata =
      record.notification_channel !== null ||
      record.notification_message !== null;
    const hasNotificationMetadata =
      record.notification_channel !== null &&
      record.notification_message !== null &&
      record.notification_message.trim() !== "";

    if (
      (hasNotification && !hasNotificationMetadata) ||
      (!hasNotification && hasAnyNotificationMetadata)
    ) {
      addIssue(
        context,
        ["notified_at"],
        "Thời điểm và nội dung thông báo học phí không đồng nhất",
      );
    }

    if (record.status === "UNPAID") {
      if (
        record.paid_amount !== null ||
        record.paid_date !== null ||
        record.refunded_amount !== 0 ||
        record.refundable_amount !== 0 ||
        record.net_collected_amount !== 0 ||
        record.refund_state !== "NONE"
      ) {
        addIssue(
          context,
          ["status"],
          "Khoản chưa nộp không được có dữ liệu thanh toán",
        );
      }

      const expectedState = hasNotification ? "NOTIFIED_UNPAID" : "UNNOTIFIED";
      if (record.notification_state !== expectedState) {
        addIssue(
          context,
          ["notification_state"],
          "Trạng thái khoản chưa nộp không hợp lệ",
        );
      }
      return;
    }

    if (
      record.notification_state !== "PAID" ||
      record.paid_amount !== record.final_amount ||
      record.paid_date === null
    ) {
      addIssue(
        context,
        ["status"],
        "Dữ liệu khoản đã nộp không đầy đủ hoặc không đồng nhất",
      );
      return;
    }

    const expectedNet = record.paid_amount - record.refunded_amount;
    const expectedRefundState =
      record.refunded_amount === 0
        ? "NONE"
        : record.refunded_amount === record.paid_amount
          ? "FULL"
          : "PARTIAL";
    if (
      record.refunded_amount > record.paid_amount ||
      record.net_collected_amount !== expectedNet ||
      record.refundable_amount !== expectedNet ||
      record.refund_state !== expectedRefundState
    ) {
      addIssue(
        context,
        ["refunded_amount"],
        "Dữ liệu hoàn phí không đồng nhất",
      );
    }
  });

export const billingReviewSchema = z.object({
  id: z.string().uuid(),
  enrollment_id: z.string().uuid(),
  student_id: z.string().uuid(),
  student_name: z.string().min(1),
  student_code: z.string().nullable(),
  class_id: z.string().uuid(),
  class_name: z.string().min(1),
  change_kind: z.enum(["ENROLLMENT_DATE_CHANGE", "PACKAGE_DURATION_CHANGE"]),
  class_billing_cycle_revision_id: z.string().uuid().nullable(),
  previous_date: isoDateSchema.nullable(),
  next_date: isoDateSchema,
  previous_weeks: z.number().int().min(1).nullable(),
  next_weeks: z.number().int().min(1).nullable(),
  next_due_date: isoDateSchema,
  state: z.enum(["PENDING", "CONFIRMED", "SUPERSEDED"]),
  reason: z.string().min(1),
  created_at: isoDateTimeSchema,
  fees: z.array(
    z.object({
      id: z.string().uuid(),
      due_date: isoDateSchema.nullable(),
      coverage_start: isoDateSchema.nullable(),
      coverage_end: isoDateSchema.nullable(),
      amount: amountSchema,
      status: z.string(),
      cancellable: z.boolean(),
      blocked_reason: z.string().nullable(),
      is_final_cycle: z.boolean(),
    }),
  ),
});

export const billingReviewListResponseSchema = z.object({
  reviews: z.array(billingReviewSchema),
  pending_count: z.number().int().nonnegative(),
});

export const feeRecordListResponseSchema = z
  .object({
    period: feeListPeriodSchema,
    records: z.array(feeRecordResponseSchema),
  })
  .superRefine((response, context) => {
    response.records.forEach((record, index) => {
      if (response.period === "outstanding" && record.status !== "UNPAID") {
        addIssue(
          context,
          ["records", index, "status"],
          "Danh sách còn phải thu chỉ được chứa khoản chưa nộp",
        );
      }
      if (
        response.period !== "upcoming" &&
        response.period !== "outstanding" &&
        record.period !== response.period
      ) {
        addIssue(
          context,
          ["records", index, "period"],
          "Kỳ học phí của bản ghi không khớp với kỳ được yêu cầu",
        );
      }
    });
  });

export const feePeriodListResponseSchema = z.object({
  periods: z.array(periodSchema),
});

export const feePaymentCapabilitiesSchema = z.object({
  early_payment_enabled: z.boolean(),
  qr_creation_enabled: z.boolean(),
  pay2s_qr_ready: z.boolean().default(false),
  automatic_recording_ready: z.boolean().default(false),
  pay2s_blocker: z.string().nullable().default(null),
  early_window_days: z.number().int().min(1).max(180),
});

export const paymentRequestResponseSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  payment_reference: z.string().regex(/^TP\d{9}P[0-9A-HJKMNP-TV-Z]{8}$/),
  status: z.enum(["OPEN", "EXPIRED", "REVOKED", "PAID", "FAILED", "REVIEW"]),
  provider: z.string().min(1).max(100),
  currency: z.literal("VND"),
  expected_amount: amountSchema.positive(),
  early_payment: z.boolean(),
  expires_at: isoDateTimeSchema.nullable(),
  sent_at: isoDateTimeSchema.nullable(),
  sent_channel: z
    .enum(["zalo_manual", "copy_message", "download_qr", "share_link", "other"])
    .nullable()
    .optional(),
  send_count: z.number().int().nonnegative().optional().default(0),
  created_at: isoDateTimeSchema,
  settlement_account_id: z.string().uuid().nullable().default(null),
  qr_payload: z
    .object({
      reference: z.string().min(1),
      amount: amountSchema.positive(),
      currency: z.literal("VND"),
      payment_url: z.string().url().nullable().optional(),
      manual_qr_url: z.string().url().nullable().optional(),
      receiving_account: z
        .object({
          id: z.string().uuid(),
          label: z.string().min(1),
          bank_name: z.string().min(1),
          account_number: z.string().min(4),
          account_name: z.string().min(1),
        })
        .optional(),
      qr_list: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .nullable(),
  items: z
    .array(
      z.object({
        fee_record_id: z.string().uuid(),
        enrollment_id: z.string().uuid(),
        student_code: z.string().regex(/^TP\d{9}$/),
        class_name: z.string().min(1),
        cycle_no: z.number().int().nonnegative(),
        base_due_date: isoDateSchema.nullable(),
        adjusted_due_date: isoDateSchema.nullable(),
        expected_amount: amountSchema.positive(),
      }),
    )
    .min(1),
});

export const paymentRequestListResponseSchema = z.object({
  requests: z.array(paymentRequestResponseSchema),
});

export const feeBatchActionResponseSchema = z
  .object({
    records: z.array(feeRecordResponseSchema),
    deleted_ids: z.array(z.string().uuid()),
  })
  .superRefine((response, context) => {
    const recordIds = new Set<string>();
    response.records.forEach((record, index) => {
      if (recordIds.has(record.id)) {
        addIssue(
          context,
          ["records", index, "id"],
          "Kết quả chứa khoản học phí trùng lặp",
        );
      }
      recordIds.add(record.id);
    });

    const deletedIds = new Set<string>();
    response.deleted_ids.forEach((id, index) => {
      if (deletedIds.has(id) || recordIds.has(id)) {
        addIssue(
          context,
          ["deleted_ids", index],
          "Kết quả xoá khoản học phí không hợp lệ",
        );
      }
      deletedIds.add(id);
    });
  });

const feeRefundReceiptSchema = z
  .object({
    request_id: z.string().uuid(),
    refund_date: isoDateSchema,
    refund_method: z.enum(["bank_transfer", "cash"]),
    reason: z.string().min(3).max(500),
    total_amount: amountSchema.positive(),
    items: z
      .array(
        z.object({
          transaction_id: z.string().uuid(),
          record_id: z.string().uuid(),
          amount: amountSchema.positive(),
          created_at: isoDateTimeSchema,
        }),
      )
      .min(1),
  })
  .superRefine((receipt, context) => {
    const itemIds = new Set<string>();
    const transactionIds = new Set<string>();
    let calculatedTotal = 0;
    receipt.items.forEach((item, index) => {
      calculatedTotal += item.amount;
      if (itemIds.has(item.record_id)) {
        addIssue(
          context,
          ["items", index, "record_id"],
          "Biên nhận chứa khoản học phí trùng lặp",
        );
      }
      itemIds.add(item.record_id);
      if (transactionIds.has(item.transaction_id)) {
        addIssue(
          context,
          ["items", index, "transaction_id"],
          "Biên nhận chứa mã giao dịch trùng lặp",
        );
      }
      transactionIds.add(item.transaction_id);
    });
    if (receipt.total_amount !== calculatedTotal) {
      addIssue(
        context,
        ["total_amount"],
        "Tổng tiền trên biên nhận hoàn phí không khớp",
      );
    }
  });

export const feeRefundBatchResponseSchema = feeBatchActionResponseSchema
  .extend({ receipt: feeRefundReceiptSchema })
  .superRefine((response, context) => {
    const recordIds = new Set(response.records.map((record) => record.id));
    const receiptIds = new Set(
      response.receipt.items.map((item) => item.record_id),
    );
    if (recordIds.size !== receiptIds.size) {
      addIssue(
        context,
        ["receipt", "items"],
        "Biên nhận không khớp với các khoản học phí đã cập nhật",
      );
    }
    response.receipt.items.forEach((item, index) => {
      if (!recordIds.has(item.record_id)) {
        addIssue(
          context,
          ["receipt", "items", index, "record_id"],
          "Biên nhận tham chiếu khoản học phí không có trong kết quả",
        );
      }
    });
  });

const feeTransactionSchema = z
  .object({
    id: z.string().uuid(),
    entry_type: z.enum([
      "payment",
      "payment_reversal",
      "refund",
      "refund_reversal",
    ]),
    amount: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    transaction_date: isoDateSchema,
    payment_method: z.enum(["bank_transfer", "cash"]),
    payment_origin: z.enum(["manual", "manual_early", "pay2s"]),
    settlement_account_id: z.string().uuid().nullable().default(null),
    settlement_bank_name: z.string().nullable().default(null),
    settlement_account_number: z.string().nullable().default(null),
    note: z.string().max(500).nullable(),
    related_payment_id: z.string().uuid().nullable(),
    request_id: z.string().uuid().nullable(),
    created_by: z.string().uuid().nullable(),
    created_by_name: z.string().min(1).max(200).nullable(),
    created_at: isoDateTimeSchema,
  })
  .superRefine((transaction, context) => {
    if (
      transaction.entry_type === "payment" &&
      (transaction.amount < 0 ||
        transaction.related_payment_id !== null ||
        transaction.request_id !== null)
    ) {
      addIssue(context, ["amount"], "Bút toán nộp học phí không hợp lệ");
    }
    if (
      transaction.entry_type === "payment_reversal" &&
      (transaction.amount > 0 || transaction.request_id !== null)
    ) {
      addIssue(context, ["amount"], "Bút toán sửa thanh toán không hợp lệ");
    }
    if (
      transaction.entry_type === "refund" &&
      (transaction.amount >= 0 ||
        transaction.related_payment_id === null ||
        transaction.request_id === null ||
        !transaction.note)
    ) {
      addIssue(context, ["amount"], "Bút toán hoàn phí không hợp lệ");
    }
    if (
      transaction.entry_type === "refund_reversal" &&
      (transaction.amount <= 0 ||
        transaction.related_payment_id === null ||
        transaction.request_id === null ||
        !transaction.note)
    ) {
      addIssue(context, ["amount"], "Bút toán hoàn tác hoàn phí không hợp lệ");
    }
  });

export const feeTransactionListResponseSchema = z.object({
  fee_record_id: z.string().uuid(),
  transactions: z.array(feeTransactionSchema),
});

export const feeTransactionBatchResponseSchema = z.object({
  histories: z.array(feeTransactionListResponseSchema),
});

export const feeRefundReversalResponseSchema =
  feeBatchActionResponseSchema.extend({
    transaction: feeTransactionSchema.refine(
      (transaction) => transaction.entry_type === "refund_reversal",
      "Giao dịch trả về không phải là hoàn tác hoàn phí",
    ),
  });

function isCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
) {
  context.addIssue({
    code: "custom",
    path,
    message,
  });
}
