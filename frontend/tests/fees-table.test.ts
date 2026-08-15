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
  assert.match(html, /Theo gói · 12 tuần/);
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

  assert.match(source, /<RefundIcon className="h-4 w-4"/);
  assert.doesNotMatch(source, /HandCoins/);
});

test("payment reversal action communicates both possible target states", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );
  const reportSource = readFileSync(
    new URL("../src/components/fees/fee-report-panel.tsx", import.meta.url),
    "utf8",
  );
  const guardSource = readFileSync(
    new URL("../src/components/providers/action-selection-guard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /bg-rose-100/);
  assert.match(source, /bg-amber-100/);
  assert.match(source, /bg-rose-200/);
  assert.match(source, /bg-amber-200/);
  assert.match(source, /border border-transparent/);
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => \{[\s\S]{0,1200}border-gray-200/,
  );
  assert.match(source, /clip-path:polygon\(0_0,100%_0,0_100%\)/);
  assert.match(source, /const isUnpayDisabled = disabled \|\| group\.refunded_amount > 0/);
  assert.match(source, /aria-disabled=\{isUnpayDisabled\}/);
  assert.match(source, /tabIndex=\{isUnpayDisabled \? -1 : undefined\}/);
  assert.match(source, /if \(!isUnpayDisabled\) onUnpay\(group\)/);
  assert.match(source, /appearance-none/);
  assert.doesNotMatch(source, /onPointerDown=\{\(event\) => \{[\s\S]{0,180}removeAllRanges/);
  assert.match(guardSource, /selectstart/);
  assert.match(guardSource, /dblclick/);
  assert.match(guardSource, /isActionContinuation/);
  assert.match(guardSource, /suppressNextClick/);
  assert.match(guardSource, /event\.stopPropagation\(\)/);
  assert.match(guardSource, /data-fee-template-editor-control/);
  assert.match(guardSource, /isSelectionPreservingTarget/);
  assert.doesNotMatch(source, /\sdisabled=\{isUnpayDisabled\}/);
  assert.doesNotMatch(source, /linear-gradient/);
  assert.doesNotMatch(source, /inset-y-\[-3px\].*-rotate-45/);
  assert.match(source, /text-gray-600/);
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => onUnpay\(group\)\}[\s\S]{0,700}disabled:opacity-50/,
  );
  assert.match(source, /Hoàn tác ghi nhận đã nộp/);
  assert.match(reportSource, /rose: "border-rose-200 bg-rose-50/);
  assert.match(reportSource, /amber: "border-amber-200 bg-amber-50/);
  assert.doesNotMatch(reportSource, /rose: "[^"]*bg-rose-100/);
  assert.doesNotMatch(reportSource, /amber: "[^"]*bg-amber-100/);
});

test("fee table gives the three date and amount columns more breathing room", () => {
  const adminGrid = getFeesTableGridClass({ isAdmin: true });

  assert.match(adminGrid, /minmax\(145px,1fr\)/);
  assert.match(adminGrid, /minmax\(150px,1\.08fr\)_118px_118px_124px_124px/);
  assert.doesNotMatch(adminGrid, /_110px_110px_116px_/);
});
