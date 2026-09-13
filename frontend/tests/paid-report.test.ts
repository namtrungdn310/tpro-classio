import assert from "node:assert/strict";
import test from "node:test";
import {
  feePaidReceiptDetailSchema,
  feePaidReceiptListSchema,
  paymentReconciliationListSchema,
} from "../src/lib/schemas/reports";
import {
  getPaidReceiptActor,
  getPaidReceiptClassSummary,
  getPaidReceiptCode,
  getPaymentMethodDistribution,
  normalizePaidReportSearch,
} from "../src/lib/reports/paid-report-view-model";

const receipt = {
  receipt_id:
    "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
  payment_operation_id: "11111111-1111-4111-8111-111111111111",
  student_id: "22222222-2222-4222-8222-222222222222",
  student_name: "Nguyễn An",
  period: "2026-07",
  paid_date: "2026-07-30",
  paid_at: "2026-07-30T08:30:00+07:00",
  payment_method: "bank_transfer" as const,
  payment_origin: "manual" as const,
  gross_amount: 1_500_000,
  refunded_amount: 250_000,
  net_amount: 1_250_000,
  refund_state: "PARTIAL" as const,
  class_count: 2,
  class_names: ["6C1", "IELTS Chuyên sâu"],
  actor_name: "Châu Thành Nam Trung",
  actor_username: "chauthanhnamtrung",
  actor_role: "admin",
};

test("paid report list accepts the compact read-only contract", () => {
  const parsed = feePaidReceiptListSchema.parse({
    receipts: [receipt],
    next_cursor: null,
    summary: {
      gross_amount: 1_500_000,
      refunded_amount: 250_000,
      net_amount: 1_250_000,
      receipt_count: 1,
      student_count: 1,
      bank_transfer_net_amount: 1_250_000,
      cash_net_amount: 0,
    },
  });

  assert.equal(parsed.receipts[0].student_name, "Nguyễn An");
  assert.equal(parsed.summary.net_amount, 1_250_000);
});

test("paid receipt detail contains allocations and financial timeline only", () => {
  const parsed = feePaidReceiptDetailSchema.parse({
    ...receipt,
    allocations: [
      {
        fee_record_id: "33333333-3333-4333-8333-333333333333",
        enrollment_id: "44444444-4444-4444-8444-444444444444",
        class_id: "55555555-5555-4555-8555-555555555555",
        class_name: "6C1",
        period: "2026-07",
        gross_amount: 750_000,
        refunded_amount: 250_000,
        net_amount: 500_000,
      },
    ],
    timeline: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        event: "refund",
        business_date: "2026-07-30",
        occurred_at: "2026-07-30T09:00:00+07:00",
        amount_delta: -250_000,
        payment_method: "bank_transfer",
        payment_origin: "manual",
        actor_name: "Châu Thành Nam Trung",
        actor_username: "chauthanhnamtrung",
        actor_role: "admin",
        reason: "Hoàn phần học chưa sử dụng",
      },
    ],
  });

  assert.equal(parsed.allocations[0].net_amount, 500_000);
  assert.equal(parsed.timeline[0].event, "refund");
  assert.equal("notification_channel" in parsed, false);
});

test("paid receipt contract rejects notification data instead of leaking it into report UI", () => {
  assert.throws(() =>
    feePaidReceiptListSchema.parse({
      receipts: [{ ...receipt, notified_at: "2026-07-29T08:00:00+07:00" }],
      next_cursor: null,
      summary: {
        gross_amount: 1_500_000,
        refunded_amount: 250_000,
        net_amount: 1_250_000,
        receipt_count: 1,
        student_count: 1,
        bank_transfer_net_amount: 1_250_000,
        cash_net_amount: 0,
      },
    }),
  );
});

test("paid report view model keeps class, actor and method distribution readable", () => {
  assert.equal(
    getPaidReceiptClassSummary(receipt),
    "6C1 và 1 lớp khác",
  );
  assert.equal(getPaidReceiptActor(receipt), "Châu Thành Nam Trung");
  assert.equal(
    getPaidReceiptCode(receipt.payment_operation_id),
    "PT-11111111",
  );
  assert.equal(normalizePaidReportSearch(" PT-11111111 "), "11111111");
  assert.deepEqual(
    getPaymentMethodDistribution({
      gross_amount: 2_000_000,
      refunded_amount: 500_000,
      net_amount: 1_500_000,
      receipt_count: 2,
      student_count: 2,
      bank_transfer_net_amount: 1_000_000,
      cash_net_amount: 500_000,
    }),
    {
      bankPercent: 66.66666666666666,
      cashPercent: 33.33333333333333,
    },
  );
});

test("payment distribution handles a zero net total without invalid widths", () => {
  assert.deepEqual(
    getPaymentMethodDistribution({
      gross_amount: 750_000,
      refunded_amount: 750_000,
      net_amount: 0,
      receipt_count: 1,
      student_count: 1,
      bank_transfer_net_amount: 0,
      cash_net_amount: 0,
    }),
    { bankPercent: 0, cashPercent: 0 },
  );
});

test("payment reconciliation accepts only the bounded review contract", () => {
  const parsed = paymentReconciliationListSchema.parse({
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        delivery_id: "22222222-2222-4222-8222-222222222222",
        status: "REVIEW",
        review_reason: "unmatched_reference_or_amount",
        resolution: null,
        payment_request_id: null,
        provider_transaction_id: "PAY2S-001",
        source: "partner_webhook",
        bank_account_id: "33333333-3333-4333-8333-333333333333",
        bank_name: "Vietcombank",
        account_number: "1234567890",
        transfer_type: "IN",
        amount: 750_000,
        content: "TP123456789PABCDEFGH",
        transaction_date: "2026-08-23T08:30:00+07:00",
        result_code: null,
        provider_message: null,
        received_at: "2026-08-23T08:30:01+07:00",
        resolved_at: null,
      },
    ],
    review_count: 1,
  });

  assert.equal(parsed.items[0].status, "REVIEW");
  assert.equal(parsed.items[0].amount, 750_000);
});
