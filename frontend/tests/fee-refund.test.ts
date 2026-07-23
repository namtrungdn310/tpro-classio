import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRefundAllocations,
  getRefundAmountErrors,
  getRefundableFeeRecords,
  validateRefundAllocations,
} from "../src/lib/fees/refund";
import {
  clearPendingRefundRequest,
  getOrCreateRefundRequestId,
} from "../src/lib/fees/refund-idempotency";
import {
  verifyFeeTransactionBatch,
  verifyFeeTransactionHistory,
} from "../src/lib/fees/transaction-integrity";
import {
  buildStudentFeeGroups,
  getGroupCopyMessage,
} from "../src/lib/fees/view-model";
import type { FeeRecordResponse } from "../src/lib/types";

const FIRST_ID = "bdeed6f6-670d-4dbe-aaf9-d40e2685be41";
const SECOND_ID = "0a214ca5-3926-4184-b2eb-3f63084663df";

function paidRecord(
  overrides: Partial<FeeRecordResponse> = {},
): FeeRecordResponse {
  return {
    id: FIRST_ID,
    enrollment_id: "0dbf1bb1-197f-4a7e-9bdd-1636c2653e36",
    student_id: "05816550-9b92-48e0-9943-f5788e41040b",
    student_name: "Nguyễn An",
    class_id: "b8421a75-5ef5-44cc-8ef9-2fab954606f5",
    class_name: "6C1",
    class_type: "MONTHLY",
    billing_cycle_months: 1,
    student_phone: null,
    student_zalo: null,
    student_contact_hidden: false,
    parent_phone: "0900000000",
    parent_zalo: "Phụ huynh An",
    parent_contact_hidden: false,
    period: "2026-07",
    enrollment_date: "2026-06-01",
    due_date: "2026-07-05",
    base_amount: 750_000,
    discount_amount: 0,
    final_amount: 750_000,
    status: "PAID",
    paid_amount: 750_000,
    paid_date: "2026-07-05",
    refunded_amount: 250_000,
    refundable_amount: 500_000,
    net_collected_amount: 500_000,
    refund_state: "PARTIAL",
    notified_at: "2026-07-05T01:00:00Z",
    notification_channel: "zalo_manual",
    notification_message: "Thông báo học phí",
    notification_state: "PAID",
    ...overrides,
  };
}

test("refund allocation accepts only positive safe amounts within each class balance", () => {
  const group = buildStudentFeeGroups([
    paidRecord(),
    paidRecord({
      id: SECOND_ID,
      enrollment_id: "f6722974-0db5-4946-b211-0ac86718d43e",
      class_id: "da72f115-5965-4eb2-9bcf-80b100809551",
      class_name: "7C1",
      paid_amount: 800_000,
      final_amount: 800_000,
      base_amount: 800_000,
      refunded_amount: 0,
      refundable_amount: 800_000,
      net_collected_amount: 800_000,
      refund_state: "NONE",
    }),
  ])[0];
  const records = getRefundableFeeRecords(group);
  const allocations = buildRefundAllocations(records, {
    [FIRST_ID]: 100_000,
    [SECOND_ID]: null,
  });

  assert.deepEqual(allocations, [{ record_id: FIRST_ID, amount: 100_000 }]);
  assert.equal(validateRefundAllocations(records, allocations), null);
  assert.match(
    validateRefundAllocations(records, [
      { record_id: FIRST_ID, amount: 500_001 },
    ]) ?? "",
    /không được vượt/,
  );
});

test("refund amount errors stay attached to the exact class amount field", () => {
  const records = [
    paidRecord(),
    paidRecord({
      id: SECOND_ID,
      class_id: "da72f115-5965-4eb2-9bcf-80b100809551",
      class_name: "7C1",
      refundable_amount: 800_000,
    }),
  ];

  assert.deepEqual(getRefundAmountErrors(records, {}), {
    [FIRST_ID]: "Vui lòng nhập số tiền cần hoàn cho ít nhất một lớp.",
  });
  assert.deepEqual(
    getRefundAmountErrors(records, {
      [FIRST_ID]: 500_001,
      [SECOND_ID]: 100_000,
    }),
    {
      [FIRST_ID]: "Số tiền hoàn không được vượt 500.000đ.",
    },
  );
  assert.deepEqual(
    getRefundAmountErrors(records, {
      [FIRST_ID]: null,
      [SECOND_ID]: 100_000,
    }),
    {},
  );
});

test("paid Zalo receipt states gross refund and current net after a refund", () => {
  const group = buildStudentFeeGroups([paidRecord()])[0];
  const message = getGroupCopyMessage(group, true);

  assert.match(message, /Cập nhật sau hoàn phí/);
  assert.match(message, /Tổng đã hoàn: 250\.000đ/);
  assert.match(message, /còn ghi nhận: 500\.000đ/);
});

test("pending refund request survives remount but is cleared after confirmation", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const ids = [
    "4829de0c-2901-4b99-a000-3e938d0a771f",
    "4053d92c-94bf-46e7-8450-10548dd99518",
  ];
  let index = 0;
  const options = {
    createId: () => ids[index++],
    now: 1_000,
    storage,
  };

  const first = getOrCreateRefundRequestId("actor:student", "same", options);
  const retry = getOrCreateRefundRequestId("actor:student", "same", options);
  assert.equal(retry, first);

  clearPendingRefundRequest("actor:student", first, storage);
  const next = getOrCreateRefundRequestId("actor:student", "same", options);
  assert.equal(next, ids[1]);
});

test("refund retry remains safe when browser storage is blocked", () => {
  const storage = {
    getItem: () => {
      throw new DOMException("Blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("Blocked", "SecurityError");
    },
    removeItem: () => {
      throw new DOMException("Blocked", "SecurityError");
    },
  };
  const requestId = "a9c64d38-a8fb-47fb-9461-a3a0269fb4d7";
  const options = {
    createId: () => requestId,
    now: 2_000,
    storage,
  };

  assert.equal(
    getOrCreateRefundRequestId("blocked:student", "same", options),
    requestId,
  );
  assert.equal(
    getOrCreateRefundRequestId("blocked:student", "same", options),
    requestId,
  );
  assert.doesNotThrow(() =>
    clearPendingRefundRequest("blocked:student", requestId, storage),
  );
});

test("transaction history responses must exactly match the requested fee records", () => {
  const firstHistory = { fee_record_id: FIRST_ID, transactions: [] };
  const secondHistory = { fee_record_id: SECOND_ID, transactions: [] };

  assert.equal(
    verifyFeeTransactionHistory(firstHistory, FIRST_ID),
    firstHistory,
  );
  assert.throws(
    () => verifyFeeTransactionHistory(firstHistory, SECOND_ID),
    /không khớp/,
  );
  assert.deepEqual(
    verifyFeeTransactionBatch(
      { histories: [secondHistory, firstHistory] },
      [FIRST_ID, SECOND_ID],
    ).histories,
    [secondHistory, firstHistory],
  );
  assert.throws(
    () =>
      verifyFeeTransactionBatch(
        { histories: [firstHistory] },
        [FIRST_ID, SECOND_ID],
      ),
    /chưa đầy đủ/,
  );
  assert.throws(
    () =>
      verifyFeeTransactionBatch(
        { histories: [firstHistory, firstHistory] },
        [FIRST_ID, SECOND_ID],
      ),
    /không hợp lệ/,
  );
});
