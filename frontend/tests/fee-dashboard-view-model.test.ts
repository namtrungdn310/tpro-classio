import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFeeViewModel,
  indexFeeRecords,
} from "../src/lib/fees/dashboard-view-model";
import type { FeeRecordResponse } from "../src/lib/types";

function feeRecord(
  overrides: Partial<FeeRecordResponse> = {},
): FeeRecordResponse {
  return {
    id: "fee-1",
    enrollment_id: "enrollment-1",
    student_id: "student-1",
    student_name: "Nguyễn An",
    class_id: "class-6",
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

test("counts mixed student fee states by record so each status metric is consistent", () => {
  const records = [
    feeRecord(),
    feeRecord({
      id: "fee-2",
      enrollment_id: "enrollment-2",
      class_id: "class-7",
      class_name: "7C1",
      final_amount: 800_000,
      base_amount: 800_000,
      notification_state: "NOTIFIED_UNPAID",
      notified_at: "2026-07-10T03:00:00Z",
    }),
    feeRecord({
      id: "fee-3",
      enrollment_id: "enrollment-3",
      student_id: "student-2",
      student_name: "Trần Bình",
      notification_state: "PAID",
      status: "PAID",
      paid_amount: 700_000,
      paid_date: "2026-07-14",
      refunded_amount: 200_000,
      refundable_amount: 500_000,
      net_collected_amount: 500_000,
      refund_state: "PARTIAL",
    }),
  ];

  const result = deriveFeeViewModel({
    activeTab: "unpaid",
    classId: "",
    indexedRecords: indexFeeRecords(records),
    matchesFeeSearch: () => true,
    unpaidStage: "unnotified",
    classes: [
      { id: "class-6", name: "6C1" },
      { id: "class-7", name: "7C1" },
    ],
  });

  assert.deepEqual(result.summary, {
    total: 2_300_000,
    grossCollected: 700_000,
    netCollected: 500_000,
    unnotified: 1,
    notified: 1,
    paid: 1,
    refunded: 200_000,
    recordCount: 3,
    outstanding: 1_550_000,
  });
  assert.equal(result.visibleGroups.length, 1);
  assert.equal(result.visibleGroups[0].student_name, "Nguyễn An");
});

test("keeps the same student's outstanding obligations separate by fee period", () => {
  const records = [
    feeRecord({ id: "fee-june", period: "2026-06", due_date: "2026-06-15" }),
    feeRecord({ id: "fee-july", period: "2026-07", due_date: "2026-07-15" }),
  ];

  const result = deriveFeeViewModel({
    activeTab: "unpaid",
    classId: "",
    indexedRecords: indexFeeRecords(records),
    matchesFeeSearch: () => true,
    unpaidStage: "unnotified",
    classes: [{ id: "class-6", name: "6C1" }],
    separatePeriods: true,
  });

  assert.equal(result.visibleGroups.length, 2);
  assert.deepEqual(
    result.visibleGroups.map((group) => group.group_key),
    ["student-1:2026-06", "student-1:2026-07"],
  );
  assert.deepEqual(
    result.visibleGroups.map((group) => group.records[0].period),
    ["2026-06", "2026-07"],
  );
});

test("scopes summary metrics to the selected class without letting search change totals", () => {
  const records = [
    feeRecord(),
    feeRecord({
      id: "fee-class-7",
      enrollment_id: "enrollment-7",
      student_id: "student-7",
      student_name: "Trần Bình",
      class_id: "class-7",
      class_name: "7C1",
      base_amount: 800_000,
      final_amount: 800_000,
      notification_state: "PAID",
      status: "PAID",
      paid_amount: 800_000,
      paid_date: "2026-07-14",
      net_collected_amount: 800_000,
      refundable_amount: 800_000,
    }),
  ];

  const result = deriveFeeViewModel({
    activeTab: "unpaid",
    classId: "class-6",
    indexedRecords: indexFeeRecords(records),
    matchesFeeSearch: () => false,
    unpaidStage: "unnotified",
    classes: [
      { id: "class-6", name: "6C1" },
      { id: "class-7", name: "7C1" },
    ],
  });

  assert.deepEqual(result.summary, {
    total: 750_000,
    grossCollected: 0,
    netCollected: 0,
    unnotified: 1,
    notified: 0,
    paid: 0,
    refunded: 0,
    recordCount: 1,
    outstanding: 750_000,
  });
  assert.equal(result.visibleGroups.length, 0);
});
