import assert from "node:assert/strict";
import test from "node:test";
import {
  canRestoreNotifiedFeeState,
  getDefaultUnpayTargetState,
  getFeeConfirmationContent,
} from "../src/lib/fees/confirmation";
import type { StudentFeeGroup } from "../src/lib/fees/view-model";

const group = {
  student_id: "student-1",
  student_name: "Nguyễn Văn A",
  total_amount: 750_000,
  classes: [{ id: "class-1", name: "6C1" }],
} as StudentFeeGroup;

test("unpay confirmation explains the selected notification target", () => {
  const target = { action: "unpay" as const, group };
  const notified = getFeeConfirmationContent(target, "NOTIFIED_UNPAID");
  const unnotified = getFeeConfirmationContent(target, "UNNOTIFIED");

  assert.match(notified.description, /đã báo, chưa nộp/);
  assert.match(notified.description, /giữ nguyên nội dung thông báo/);
  assert.match(unnotified.description, /chưa báo, chưa nộp/);
  assert.match(unnotified.description, /nếu có/);
  assert.match(unnotified.description, /sẽ được xoá/);
});

test("direct payments can only be reversed to the truthful unnotified state", () => {
  const directPayment = {
    ...group,
    records: [
      {
        notified_at: null,
        notification_channel: null,
        notification_message: null,
      },
    ],
  } as StudentFeeGroup;
  const notifiedPayment = {
    ...group,
    records: [
      {
        notified_at: "2026-07-15T08:00:00Z",
        notification_channel: "zalo_manual",
        notification_message: "Thông báo học phí",
      },
    ],
  } as StudentFeeGroup;

  assert.equal(canRestoreNotifiedFeeState(directPayment), false);
  assert.equal(getDefaultUnpayTargetState(directPayment), "UNNOTIFIED");
  assert.equal(canRestoreNotifiedFeeState(notifiedPayment), true);
  assert.equal(getDefaultUnpayTargetState(notifiedPayment), "NOTIFIED_UNPAID");
});
