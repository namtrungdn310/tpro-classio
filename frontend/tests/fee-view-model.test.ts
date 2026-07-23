import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudentFeeGroups,
  getGroupCopyMessage,
  renderGroupFeeMessage,
} from "../src/lib/fees/view-model";
import { DEFAULT_FEE_MESSAGE_TEMPLATES } from "../src/lib/fees/message-templates";
import type { FeeRecordResponse } from "../src/lib/types";

function feeRecord(overrides: Partial<FeeRecordResponse> = {}): FeeRecordResponse {
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

function buildDefaultGroupFeeMessage(
  group: ReturnType<typeof buildStudentFeeGroups>[number],
  isPaid: boolean,
) {
  return renderGroupFeeMessage(
    group,
    isPaid,
    isPaid
      ? DEFAULT_FEE_MESSAGE_TEMPLATES.payment_received_template
      : DEFAULT_FEE_MESSAGE_TEMPLATES.payment_reminder_template,
  );
}

test("groups distinct dates explicitly and keeps the earliest date as the summary", () => {
  const groups = buildStudentFeeGroups([
    feeRecord({
      id: "fee-ielts",
      class_id: "class-ielts",
      class_name: "IELTS Chuyên sâu",
      enrollment_date: "2026-06-20",
      due_date: "2026-07-20",
    }),
    feeRecord({
      id: "fee-6c1",
      enrollment_date: "2026-06-05",
      due_date: "2026-07-05",
    }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].enrollment_date, "2026-06-05");
  assert.deepEqual(groups[0].enrollment_dates, ["2026-06-05", "2026-06-20"]);
  assert.equal(groups[0].due_date, "2026-07-05");
  assert.deepEqual(groups[0].due_dates, ["2026-07-05", "2026-07-20"]);
  assert.deepEqual(groups[0].classes.map((class_) => class_.name), ["6C1", "IELTS Chuyên sâu"]);
});

test("builds an unpaid message from each real class, amount and due date", () => {
  const group = buildStudentFeeGroups([
    feeRecord(),
    feeRecord({
      id: "fee-ielts",
      class_id: "class-ielts",
      class_name: "IELTS Chuyên sâu",
      class_type: "COURSE",
      billing_cycle_months: 3,
      due_date: "2026-07-28",
      final_amount: 1_250_000,
      base_amount: 1_250_000,
    }),
  ])[0];

  assert.equal(
    buildDefaultGroupFeeMessage(group, false),
    [
      "TPRO English xin thông báo học phí tháng 7/2026 của em Nguyễn An:",
      "6C1: 750.000đ",
      "IELTS Chuyên sâu: 1.250.000đ",
      "Ngày đến hạn: 6C1: 15/07/2026; IELTS Chuyên sâu: 28/07/2026.",
      "Tổng học phí cần thanh toán: 2.000.000đ.",
      "Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.",
    ].join("\n"),
  );
  assert.equal(
    buildDefaultGroupFeeMessage(group, false).includes("Zalo PH"),
    false,
  );
  assert.equal(
    buildDefaultGroupFeeMessage(group, false).includes("khóa học trước"),
    false,
  );
});

test("renders past due dates without adding status text to the saved template", () => {
  const group = buildStudentFeeGroups([
    feeRecord({ due_date: "2026-07-05" }),
  ])[0];
  const message = buildDefaultGroupFeeMessage(group, false);

  assert.match(message, /Ngày đến hạn: 05\/07\/2026\./);
  assert.doesNotMatch(message, /\(đã đến hạn\)/i);
  assert.doesNotMatch(message, /nhắc quá hạn|thu trong hôm nay/i);
});

test("builds a paid confirmation from paid amounts and actual paid dates", () => {
  const group = buildStudentFeeGroups([
    feeRecord({
      notification_state: "PAID",
      status: "PAID",
      paid_amount: 700_000,
      paid_date: "2026-07-14",
    }),
    feeRecord({
      id: "fee-7c1",
      class_id: "class-7",
      class_name: "7C1",
      final_amount: 800_000,
      base_amount: 800_000,
      notification_state: "PAID",
      status: "PAID",
      paid_amount: null,
      paid_date: null,
    }),
  ])[0];

  assert.equal(
    buildDefaultGroupFeeMessage(group, true),
    [
      "TPRO English xác nhận đã nhận học phí tháng 7/2026 của em Nguyễn An:",
      "6C1: 700.000đ",
      "7C1: 800.000đ",
      "Ngày đến hạn: 15/07/2026.",
      "Tổng học phí đã nhận: 1.500.000đ.",
      "Cảm ơn phụ huynh.",
    ].join("\n"),
  );
});

test("copies the immutable notification snapshot after a fee was announced", () => {
  const snapshot = "Nội dung đã báo phụ huynh tại thời điểm chốt học phí.";
  const groups = buildStudentFeeGroups([
    feeRecord({
      notification_state: "NOTIFIED_UNPAID",
      notified_at: "2026-07-10T02:00:00Z",
      notification_message: snapshot,
      student_name: "Tên hiện tại đã thay đổi",
    }),
  ]);

  assert.equal(
    getGroupCopyMessage(groups[0], false, {
      payment_reminder_template:
        "Mẫu mới {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}",
      payment_received_template:
        "Đã nhận {{ten_hoc_vien}} {{ky_hoc_phi}} {{chi_tiet_hoc_phi}} {{tong_tien}}",
    }),
    snapshot,
  );
});

test("renders reminder and receipt from two independent custom templates", () => {
  const group = buildStudentFeeGroups([feeRecord()])[0];

  assert.equal(
    renderGroupFeeMessage(
      group,
      false,
      "Nhắc {{ten_hoc_vien}} | {{ky_hoc_phi}} | {{chi_tiet_hoc_phi}} | Hạn {{ngay_den_han}} | {{tong_tien}}",
    ),
    "Nhắc Nguyễn An | tháng 7/2026 | 6C1: 750.000đ | Hạn 15/07/2026 | 750.000đ",
  );
  assert.equal(
    renderGroupFeeMessage(
      group,
      true,
      "Đã nhận của {{ten_hoc_vien}}: {{tong_tien}}\n{{chi_tiet_hoc_phi}}\nHạn {{ngay_den_han}}\n{{ky_hoc_phi}}",
    ),
    "Đã nhận của Nguyễn An: 750.000đ\n6C1: 750.000đ\nHạn 15/07/2026\ntháng 7/2026",
  );
});

test("uses each saved custom template in the matching copy action", () => {
  const group = buildStudentFeeGroups([
    feeRecord({ due_date: "2026-07-28" }),
  ])[0];
  const templates = {
    payment_reminder_template:
      "Mời phụ huynh của {{ten_hoc_vien}} đóng {{tong_tien}} cho {{ky_hoc_phi}}:\n{{chi_tiet_hoc_phi}}\nHạn {{ngay_den_han}}",
    payment_received_template:
      "Đã nhận {{tong_tien}} của {{ten_hoc_vien}} cho {{ky_hoc_phi}}:\n{{chi_tiet_hoc_phi}}\nHạn {{ngay_den_han}}",
  };

  assert.equal(
    getGroupCopyMessage(group, false, templates),
    "Mời phụ huynh của Nguyễn An đóng 750.000đ cho tháng 7/2026:\n6C1: 750.000đ\nHạn 28/07/2026",
  );
  assert.equal(
    getGroupCopyMessage(group, true, templates),
    "Đã nhận 750.000đ của Nguyễn An cho tháng 7/2026:\n6C1: 750.000đ\nHạn 28/07/2026",
  );
});

test("renders token-like student data as opaque text in a single pass", () => {
  const group = buildStudentFeeGroups([
    feeRecord({
      student_name: "An {{tong_tien}}",
      class_name: "Lớp {{ky_hoc_phi}}",
    }),
  ])[0];

  const message = renderGroupFeeMessage(
    group,
    false,
    "{{ten_hoc_vien}}\n{{chi_tiet_hoc_phi}}\n{{ngay_den_han}}\n{{tong_tien}}\n{{ky_hoc_phi}}",
  );

  assert.match(message, /^An \{\{tong_tien\}\}/);
  assert.match(message, /Lớp \{\{ky_hoc_phi\}\}/);
});

test("copies every distinct immutable snapshot instead of rewriting history", () => {
  const group = buildStudentFeeGroups([
    feeRecord({
      notification_state: "NOTIFIED_UNPAID",
      notified_at: "2026-07-10T02:00:00Z",
      notification_message: "Thông báo lớp 6C1.",
    }),
    feeRecord({
      id: "fee-2",
      class_id: "class-7",
      class_name: "7C1",
      notification_state: "NOTIFIED_UNPAID",
      notified_at: "2026-07-11T02:00:00Z",
      notification_message: "Thông báo lớp 7C1.",
    }),
  ])[0];

  assert.equal(
    getGroupCopyMessage(group, false),
    "Thông báo lớp 6C1.\n\nThông báo lớp 7C1.",
  );
});
