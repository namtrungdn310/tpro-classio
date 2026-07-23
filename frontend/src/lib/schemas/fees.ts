import { z } from "zod";
import { feeMessageTemplatesResponseSchema } from "@/lib/fees/message-templates";

export { feeMessageTemplatesResponseSchema };

const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

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
    (value) => isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)),
    "Thời điểm không hợp lệ",
  );

const amountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const notificationStateSchema = z.enum(["UNNOTIFIED", "NOTIFIED_UNPAID", "PAID"]);
const feeStatusSchema = z.enum(["UNPAID", "PAID"]);
const refundStateSchema = z.enum(["NONE", "PARTIAL", "FULL"]);
const notificationChannelSchema = z.enum(["zalo_manual", "zalo_copy"]);

export const feeRecordResponseSchema = z
  .object({
    id: z.string().uuid(),
    enrollment_id: z.string().uuid(),
    student_id: z.string().uuid(),
    student_name: z.string().min(1),
    class_id: z.string().uuid(),
    class_name: z.string().min(1),
    class_type: z.enum(["MONTHLY", "COURSE"]),
    billing_cycle_months: z.number().int().min(1).max(24),
    student_phone: z.string().nullable(),
    student_zalo: z.string().nullable(),
    student_contact_hidden: z.boolean(),
    parent_phone: z.string().nullable(),
    parent_zalo: z.string().nullable(),
    parent_contact_hidden: z.boolean(),
    period: periodSchema,
    enrollment_date: isoDateSchema.nullable(),
    due_date: isoDateSchema.nullable(),
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
      addIssue(context, ["discount_amount"], "Mức giảm không được vượt học phí gốc");
    }

    if (record.final_amount > record.base_amount) {
      addIssue(context, ["final_amount"], "Học phí cuối cùng không được vượt học phí gốc");
    }

    const hasNotification = record.notified_at !== null;
    const hasAnyNotificationMetadata =
      record.notification_channel !== null || record.notification_message !== null;
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
        addIssue(context, ["status"], "Khoản chưa nộp không được có dữ liệu thanh toán");
      }

      const expectedState = hasNotification ? "NOTIFIED_UNPAID" : "UNNOTIFIED";
      if (record.notification_state !== expectedState) {
        addIssue(context, ["notification_state"], "Trạng thái khoản chưa nộp không hợp lệ");
      }
      return;
    }

    if (
      record.notification_state !== "PAID" ||
      record.paid_amount !== record.final_amount ||
      record.paid_date === null
    ) {
      addIssue(context, ["status"], "Dữ liệu khoản đã nộp không đầy đủ hoặc không đồng nhất");
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
      addIssue(context, ["refunded_amount"], "Dữ liệu hoàn phí không đồng nhất");
    }
  });

export const feeRecordListResponseSchema = z
  .object({
    period: periodSchema,
    records: z.array(feeRecordResponseSchema),
  })
  .superRefine((response, context) => {
    response.records.forEach((record, index) => {
      if (record.period !== response.period) {
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

export const feeBatchActionResponseSchema = z
  .object({
    records: z.array(feeRecordResponseSchema),
    deleted_ids: z.array(z.string().uuid()),
  })
  .superRefine((response, context) => {
    const recordIds = new Set<string>();
    response.records.forEach((record, index) => {
      if (recordIds.has(record.id)) {
        addIssue(context, ["records", index, "id"], "Kết quả chứa khoản học phí trùng lặp");
      }
      recordIds.add(record.id);
    });

    const deletedIds = new Set<string>();
    response.deleted_ids.forEach((id, index) => {
      if (deletedIds.has(id) || recordIds.has(id)) {
        addIssue(context, ["deleted_ids", index], "Kết quả xoá khoản học phí không hợp lệ");
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
    const receiptIds = new Set(response.receipt.items.map((item) => item.record_id));
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
    amount: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    transaction_date: isoDateSchema,
    payment_method: z.enum(["bank_transfer", "cash"]),
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

export const feeRefundReversalResponseSchema = feeBatchActionResponseSchema.extend({
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
