import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeeDetailRows,
  buildFeeSummaryRows,
  buildFeeTransactionRows,
} from "../src/lib/fees/export";
import { buildStudentFeeGroups } from "../src/lib/fees/view-model";
import type { FeeRecordResponse } from "../src/lib/types";

function feeRecord(overrides: Partial<FeeRecordResponse> = {}): FeeRecordResponse {
  return {
    id: "0cfd47e7-4114-41c0-bff1-bbf1b6ce0189",
    enrollment_id: "480ba7f5-8f39-43cc-9040-5e28266701ab",
    student_id: "9d6c0beb-5603-47ba-8c83-f3414bc4cfc5",
    student_name: "Nguyễn An",
    class_id: "a1b52e4a-9a72-4de0-a5a8-0673e74871e4",
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

const context = {
  activeTab: "unpaid",
  period: "2026-07",
  unpaidStage: "unnotified",
} as const;

test("fee export keeps student and parent contact pairs in separate columns", () => {
  const group = buildStudentFeeGroups([feeRecord()]);
  const summary = buildFeeSummaryRows(group, context)[0];
  const detail = buildFeeDetailRows(group, context)[0];

  for (const row of [summary, detail]) {
    assert.equal(row["Zalo học viên"], "Nguyễn An");
    assert.equal(row["SĐT học viên"], "0988888888");
    assert.equal(row["Zalo phụ huynh"], "Phụ huynh An");
    assert.equal(row["SĐT phụ huynh"], "0900000000");
  }
  assert.equal(summary["Hình thức học phí"], "6C1: Theo tháng");
  assert.equal(detail["Hình thức học phí"], "Theo tháng");
});

test("fee export identifies the duration of course-based tuition", () => {
  const group = buildStudentFeeGroups([
    feeRecord({ class_type: "COURSE", billing_cycle_months: 3 }),
  ]);
  const summary = buildFeeSummaryRows(group, context)[0];
  const detail = buildFeeDetailRows(group, context)[0];

  assert.equal(summary["Hình thức học phí"], "6C1: Theo khóa · 12 tuần");
  assert.equal(detail["Hình thức học phí"], "Theo khóa · 12 tuần");
});

test("fee export leaves redacted contact pairs empty", () => {
  const group = buildStudentFeeGroups([
    feeRecord({
      student_phone: null,
      student_zalo: null,
      student_contact_hidden: true,
      parent_phone: null,
      parent_zalo: null,
      parent_contact_hidden: true,
    }),
  ]);
  const row = buildFeeSummaryRows(group, context)[0];

  assert.equal(row["Zalo học viên"], "");
  assert.equal(row["SĐT học viên"], "");
  assert.equal(row["Zalo phụ huynh"], "");
  assert.equal(row["SĐT phụ huynh"], "");
});

test("fee export includes immutable refund ledger details", () => {
  const record = feeRecord();
  const groups = buildStudentFeeGroups([record]);
  const rows = buildFeeTransactionRows(
    groups,
    [
      {
        fee_record_id: record.id,
        transactions: [
          {
            id: "e014ba04-b274-4c78-a83e-d7664e441fe8",
            entry_type: "refund",
            amount: -250_000,
            transaction_date: "2026-07-16",
            payment_method: "bank_transfer",
            note: "Học viên dừng khóa học sớm",
            related_payment_id: "595f4526-5505-4255-8142-510e42f8b0b0",
            request_id: "147ed194-1ad7-4a52-be9e-df4ec709ba1d",
            created_by: "c8125659-2a58-48c3-ae60-53c4ad3cda2b",
            created_by_name: "Quản trị viên",
            created_at: "2026-07-16T03:30:00Z",
          },
        ],
      },
    ],
    context,
  );

  assert.equal(rows[0]["Loại giao dịch"], "Hoàn phí");
  assert.equal(rows[0]["Số tiền tăng/giảm (đ)"], -250_000);
  assert.equal(rows[0]["Người thao tác"], "Quản trị viên");
  assert.equal(rows[0]["Lý do / nội dung"], "Học viên dừng khóa học sớm");
});
