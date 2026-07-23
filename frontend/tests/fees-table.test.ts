import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeesTable } from "../src/components/fees/fees-table";
import { getFeesTableGridClass } from "../src/components/fees/table-layout";
import type { StudentFeeGroup } from "../src/lib/fees/view-model";
import type { FeeRecordResponse } from "../src/lib/types";

const monthlyRecord = {
  id: "fee-monthly",
  enrollment_id: "enrollment-monthly",
  student_id: "student-long-content",
  student_name: "Nguyễn Hoàng Anh Minh với tên đầy đủ cần được hiển thị",
  class_id: "class-1",
  class_name: "IELTS Chuyên sâu",
  class_type: "MONTHLY",
  billing_cycle_months: 1,
  student_phone: "0988123456",
  student_zalo: "Nguyễn Hoàng Anh Minh",
  student_contact_hidden: false,
  parent_phone: "0912345678",
  parent_zalo: "Phụ huynh Nguyễn Hoàng Anh Minh",
  parent_contact_hidden: false,
  period: "2026-07",
  enrollment_date: "2026-06-01",
  due_date: "2026-07-01",
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
} satisfies FeeRecordResponse;

const courseRecord = {
  ...monthlyRecord,
  id: "fee-course",
  enrollment_id: "enrollment-course",
  class_id: "class-2",
  class_name: "Học sinh giỏi thành phố lớp 9",
  class_type: "COURSE",
  billing_cycle_months: 3,
} satisfies FeeRecordResponse;

const group = {
  student_id: "student-long-content",
  student_name: "Nguyễn Hoàng Anh Minh với tên đầy đủ cần được hiển thị",
  student_zalo: "Nguyễn Hoàng Anh Minh",
  student_phone: "0988123456",
  student_contact_hidden: false,
  parent_zalo: "Phụ huynh Nguyễn Hoàng Anh Minh",
  parent_phone: "0912345678",
  parent_contact_hidden: false,
  total_amount: 1_505_000,
  gross_paid_amount: 0,
  refunded_amount: 0,
  net_collected_amount: 0,
  refundable_amount: 0,
  enrollment_date: "2026-06-01",
  enrollment_dates: ["2026-06-01", "2026-06-15"],
  due_date: "2026-07-01",
  due_dates: ["2026-07-01", "2026-07-15"],
  paid_date: null,
  notified_at: null,
  classes: [
    { id: "class-1", name: "IELTS Chuyên sâu" },
    { id: "class-2", name: "Học sinh giỏi thành phố lớp 9" },
  ],
  records: [monthlyRecord, courseRecord],
} satisfies StudentFeeGroup;

function renderFeesTable(isAdmin: boolean) {
  const onGroup = () => undefined;

  return renderToStaticMarkup(
    createElement(FeesTable, {
      activeTab: "unpaid",
      unpaidStage: "unnotified",
      groups: [group],
      isAdmin,
      isBusy: false,
      isMessageUnavailable: false,
      pendingAction: null,
      pendingStudentId: null,
      onCopy: onGroup,
      onNotify: onGroup,
      onPay: onGroup,
      onRefund: onGroup,
      onUnpay: onGroup,
      onUnnotify: onGroup,
    }),
  );
}

test("fee table keeps its header outside the hidden-scrollbar record list", () => {
  const html = renderFeesTable(true);

  assert.equal((html.match(/role="rowgroup"/g) ?? []).length, 2);
  assert.match(html, /shrink-0 border-b/);
  assert.match(html, /scrollbar-hidden min-h-0 flex-1/);
  assert.match(html, /overflow-x-hidden overflow-y-auto/);
  assert.doesNotMatch(html, /\bsticky\b/);
});

test("fee table renders long and multi-date values without truncation", () => {
  const html = renderFeesTable(true);

  assert.match(html, /Nguyễn Hoàng Anh Minh với tên đầy đủ cần được hiển thị/);
  assert.match(html, /IELTS Chuyên sâu/);
  assert.match(html, /Học sinh giỏi thành phố lớp 9/);
  assert.match(html, /Theo tháng/);
  assert.match(html, /Theo khóa · 12 tuần/);
  assert.match(html, /01\/06\/2026, 15\/06\/2026/);
  assert.match(html, /01\/07\/2026, 15\/07\/2026/);
  assert.match(html, /Thông tin học viên/);
  assert.match(html, /Thông tin phụ huynh/);
  assert.match(html, /Nguyễn Hoàng Anh Minh/);
  assert.match(html, /Phụ huynh Nguyễn Hoàng Anh Minh/);
  assert.match(html, /data-text-selection-scope="true"/);
  assert.match(html, /data-text-selection-value="true"/);
  assert.doesNotMatch(html, /\btruncate\b|line-clamp|text-ellipsis/);
  assert.doesNotMatch(html, /\(\+\d+\)/);
});

test("viewer fee table omits the unavailable actions column", () => {
  const viewerHtml = renderFeesTable(false);
  const adminHtml = renderFeesTable(true);

  assert.equal((viewerHtml.match(/role="columnheader"/g) ?? []).length, 7);
  assert.doesNotMatch(viewerHtml, />Thao tác</);
  assert.equal((adminHtml.match(/role="columnheader"/g) ?? []).length, 8);
  assert.match(adminHtml, />Thao tác</);
});

test("unnotified fees can be recorded as paid without a prior notification", () => {
  const html = renderFeesTable(true);
  const payButton = html.match(
    /<button[^>]*title="Ghi nhận đã nộp"[^>]*aria-label="Ghi nhận đã nộp"[^>]*>/,
  );

  assert.ok(payButton);
  assert.doesNotMatch(payButton[0], /\sdisabled=""/);
  assert.doesNotMatch(html, /Cần đánh dấu đã báo trước/);
});

test("paid fee actions use the shared refund icon", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<RefundIcon \/>/);
  assert.doesNotMatch(source, /HandCoins/);
});

test("fee table gives the three date and amount columns more breathing room", () => {
  const adminGrid = getFeesTableGridClass({ isAdmin: true });

  assert.match(adminGrid, /minmax\(145px,1fr\)/);
  assert.match(adminGrid, /minmax\(150px,1\.08fr\)_118px_118px_124px_124px/);
  assert.doesNotMatch(adminGrid, /_110px_110px_116px_/);
});
