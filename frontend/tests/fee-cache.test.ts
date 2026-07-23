import assert from "node:assert/strict";
import test from "node:test";
import { mergeFeeBatchActionResult } from "../src/lib/fees/cache";
import type { FeeRecordResponse } from "../src/lib/types";

function feeRecord(id: string, overrides: Partial<FeeRecordResponse> = {}): FeeRecordResponse {
  return {
    id,
    enrollment_id: `enrollment-${id}`,
    student_id: `student-${id}`,
    student_name: `Học viên ${id}`,
    class_id: "class-1",
    class_name: "6C1",
    class_type: "MONTHLY",
    billing_cycle_months: 1,
    student_phone: null,
    student_zalo: null,
    student_contact_hidden: false,
    parent_phone: null,
    parent_zalo: null,
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

test("merges every batch update and deletion into a fee cache in one immutable pass", () => {
  const first = feeRecord("fee-1");
  const second = feeRecord("fee-2");
  const untouched = feeRecord("fee-3");
  const updatedFirst = feeRecord("fee-1", {
    notification_state: "NOTIFIED_UNPAID",
    notified_at: "2026-07-15T03:00:00Z",
  });
  const current = { period: "2026-07", records: [first, second, untouched] };

  const merged = mergeFeeBatchActionResult(current, {
    records: [updatedFirst, feeRecord("fee-not-in-this-cache")],
    deleted_ids: ["fee-2"],
  });

  assert.notEqual(merged, current);
  assert.deepEqual(merged.records.map((record) => record.id), ["fee-1", "fee-3"]);
  assert.equal(merged.records[0], updatedFirst);
  assert.equal(merged.records[1], untouched);
  assert.deepEqual(current.records, [first, second, untouched]);
});

test("returns the existing cache object when a batch has no changes", () => {
  const current = { period: "2026-07", records: [feeRecord("fee-1")] };

  assert.equal(
    mergeFeeBatchActionResult(current, { records: [], deleted_ids: [] }),
    current,
  );
});
