import assert from "node:assert/strict";
import test from "node:test";
import {
  feeBatchActionResponseSchema,
  feeRefundBatchResponseSchema,
  feePeriodListResponseSchema,
  feeRecordListResponseSchema,
  feeRecordResponseSchema,
} from "../src/lib/schemas/fees";

const IDS = {
  record: "0cfd47e7-4114-41c0-bff1-bbf1b6ce0189",
  enrollment: "480ba7f5-8f39-43cc-9040-5e28266701ab",
  student: "9d6c0beb-5603-47ba-8c83-f3414bc4cfc5",
  class_: "a1b52e4a-9a72-4de0-a5a8-0673e74871e4",
  deleted: "c59400fd-6350-4402-a732-69c30893dd18",
};

function feeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.record,
    enrollment_id: IDS.enrollment,
    student_id: IDS.student,
    student_name: "Nguyễn An",
    class_id: IDS.class_,
    class_name: "6C1",
    class_type: "MONTHLY",
    billing_cycle_months: 1,
    student_phone: "0988888888",
    student_zalo: "Nguyễn An",
    student_contact_hidden: false,
    parent_phone: "0900000000",
    parent_zalo: "Phụ huynh An",
    parent_contact_hidden: false,
    period: "2026-07",
    enrollment_date: "2026-06-15",
    due_date: "2026-07-15",
    base_amount: 750_000,
    discount_amount: 0,
    final_amount: 750_000,
    status: "UNPAID",
    paid_amount: null,
    paid_date: null,
    refunded_amount: 0,
    refundable_amount: 0,
    net_collected_amount: 0,
    refund_state: "NONE",
    notified_at: null,
    notification_channel: null,
    notification_message: null,
    notification_state: "UNNOTIFIED",
    ...overrides,
  };
}

test("accepts coherent unnotified, notified-unpaid and paid fee records", () => {
  assert.equal(feeRecordResponseSchema.parse(feeRecord()).notification_state, "UNNOTIFIED");

  const notified = feeRecordResponseSchema.parse(
    feeRecord({
      notified_at: "2026-07-15T08:30:00+07:00",
      notification_channel: "zalo_manual",
      notification_message: "Thông báo học phí tháng 7",
      notification_state: "NOTIFIED_UNPAID",
    }),
  );
  assert.equal(notified.notification_state, "NOTIFIED_UNPAID");

  const paid = feeRecordResponseSchema.parse(
    feeRecord({
      status: "PAID",
      paid_amount: 750_000,
      paid_date: "2026-07-15",
      refundable_amount: 750_000,
      net_collected_amount: 750_000,
      notified_at: "2026-07-15T08:30:00Z",
      notification_channel: "zalo_copy",
      notification_message: "Thông báo học phí tháng 7",
      notification_state: "PAID",
    }),
  );
  assert.equal(paid.status, "PAID");

  const paidBeforeNotification = feeRecordResponseSchema.parse(
    feeRecord({
      status: "PAID",
      paid_amount: 750_000,
      paid_date: "2026-07-15",
      refundable_amount: 750_000,
      net_collected_amount: 750_000,
      notification_state: "PAID",
    }),
  );
  assert.equal(paidBeforeNotification.notification_state, "PAID");
  assert.equal(paidBeforeNotification.notified_at, null);
});

test("rejects malformed identifiers, periods, dates, datetimes and unsafe amounts", () => {
  assert.throws(() => feeRecordResponseSchema.parse(feeRecord({ id: "fee-1" })));
  assert.throws(() => feeRecordResponseSchema.parse(feeRecord({ period: "2026-13" })));
  assert.throws(() => feeRecordResponseSchema.parse(feeRecord({ due_date: "2026-02-30" })));
  assert.throws(() =>
    feeRecordResponseSchema.parse(feeRecord({ notified_at: "2026-07-15 08:30:00" })),
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(feeRecord({ notified_at: "2026-02-30T08:30:00Z" })),
  );
  assert.throws(() => feeRecordResponseSchema.parse(feeRecord({ final_amount: -1 })));
  assert.throws(() =>
    feeRecordResponseSchema.parse(feeRecord({ base_amount: Number.MAX_SAFE_INTEGER + 1 })),
  );
});

test("rejects inconsistent payment and notification states", () => {
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({ status: "PAID", notification_state: "PAID", paid_amount: 750_000 }),
    ),
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({
        notified_at: "2026-07-15T08:30:00Z",
        notification_channel: null,
        notification_message: null,
        notification_state: "NOTIFIED_UNPAID",
      }),
    ),
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({ notification_message: "Thông báo không có thời điểm gửi" }),
    ),
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({ paid_amount: 750_000, paid_date: "2026-07-15" }),
    ),
  );
});

test("accepts only complete or fully redacted student and parent contacts", () => {
  assert.equal(
    feeRecordResponseSchema.parse(feeRecord()).student_phone,
    "0988888888",
  );
  assert.equal(
    feeRecordResponseSchema.parse(
      feeRecord({
        student_phone: null,
        student_zalo: null,
        student_contact_hidden: true,
        parent_phone: null,
        parent_zalo: null,
        parent_contact_hidden: true,
      }),
    ).student_contact_hidden,
    true,
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({ student_phone: "0988888888", student_zalo: null }),
    ),
  );
  assert.throws(() =>
    feeRecordResponseSchema.parse(
      feeRecord({
        parent_contact_hidden: true,
        parent_phone: "0900000000",
        parent_zalo: "Phụ huynh An",
      }),
    ),
  );
});

test("validates list period consistency and period-list values", () => {
  assert.equal(
    feeRecordListResponseSchema.parse({ period: "2026-07", records: [feeRecord()] }).records
      .length,
    1,
  );
  assert.throws(() =>
    feeRecordListResponseSchema.parse({
      period: "2026-08",
      records: [feeRecord({ period: "2026-07" })],
    }),
  );
  assert.deepEqual(feePeriodListResponseSchema.parse({ periods: ["2026-07"] }).periods, [
    "2026-07",
  ]);
  assert.throws(() => feePeriodListResponseSchema.parse({ periods: ["2026-00"] }));
});

test("validates batch responses and rejects duplicate or overlapping ids", () => {
  assert.equal(
    feeBatchActionResponseSchema.parse({
      records: [feeRecord()],
      deleted_ids: [IDS.deleted],
    }).records.length,
    1,
  );
  assert.throws(() =>
    feeBatchActionResponseSchema.parse({
      records: [feeRecord(), feeRecord()],
      deleted_ids: [],
    }),
  );
  assert.throws(() =>
    feeBatchActionResponseSchema.parse({
      records: [feeRecord()],
      deleted_ids: [IDS.record],
    }),
  );
});

test("refund receipt must match its records, item total and transaction ids", () => {
  const refundedRecord = feeRecord({
    status: "PAID",
    paid_amount: 750_000,
    paid_date: "2026-07-15",
    refunded_amount: 250_000,
    refundable_amount: 500_000,
    net_collected_amount: 500_000,
    refund_state: "PARTIAL",
    notified_at: "2026-07-15T08:30:00Z",
    notification_channel: "zalo_copy",
    notification_message: "Thông báo học phí tháng 7",
    notification_state: "PAID",
  });
  const response = {
    records: [refundedRecord],
    deleted_ids: [],
    receipt: {
      request_id: "d98b568b-654a-4824-9e81-a6f1dedc36be",
      refund_date: "2026-07-16",
      refund_method: "bank_transfer",
      reason: "Học viên dừng khóa học sớm",
      total_amount: 250_000,
      items: [
        {
          transaction_id: "c269da6d-0abb-44bc-b732-2c937cb5b622",
          record_id: IDS.record,
          amount: 250_000,
          created_at: "2026-07-16T03:30:00Z",
        },
      ],
    },
  };

  assert.equal(feeRefundBatchResponseSchema.safeParse(response).success, true);
  assert.equal(
    feeRefundBatchResponseSchema.safeParse({
      ...response,
      receipt: { ...response.receipt, total_amount: 1 },
    }).success,
    false,
  );
  assert.equal(
    feeRefundBatchResponseSchema.safeParse({
      ...response,
      records: [],
    }).success,
    false,
  );
});
