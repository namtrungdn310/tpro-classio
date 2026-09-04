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
  group_key: "student-long-content",
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

function renderFeesTable(isAdmin: boolean, showPeriod = false) {
  const onGroup = () => undefined;

  return renderToStaticMarkup(
    createElement(FeesTable, {
      activeTab: "unpaid",
      unpaidStage: "unnotified",
      groups: [group],
      isAdmin,
      isBusy: false,
      isMessageUnavailable: false,
      canCreatePaymentRequest: true,
      pendingAction: null,
      pendingGroupKey: null,
      showPeriod,
      onCopy: onGroup,
      onSaveCopy: onGroup,
      isSavingCopy: false,
      onNotify: onGroup,
      onCreatePaymentRequest: onGroup,
      onPay: onGroup,
      onPrepareRefundHistory: onGroup,
      onRefund: onGroup,
      onUnpay: onGroup,
      onUnnotify: onGroup,
      getCopyMessage: () => "Nội dung Zalo dành riêng cho học viên",
      refundPanel: () => null,
      onCloseRefund: () => undefined,
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

test("outstanding table shows the original fee period and due-state label", () => {
  const html = renderFeesTable(true, true);

  assert.match(html, />Kỳ thu</);
  assert.match(html, />7\/2026</);
  assert.match(html, />(?:Quá hạn|Đến hạn hôm nay)</);
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

test("fee table keeps actions out of the permanent column layout", () => {
  const viewerHtml = renderFeesTable(false);
  const adminHtml = renderFeesTable(true);

  assert.equal((viewerHtml.match(/role="columnheader"/g) ?? []).length, 7);
  assert.doesNotMatch(viewerHtml, /role="columnheader"[^>]*>Thao tác</);
  assert.equal((adminHtml.match(/role="columnheader"/g) ?? []).length, 7);
  assert.doesNotMatch(adminHtml, /role="columnheader"[^>]*>Thao tác</);
  assert.match(adminHtml, /role="row" tabindex="0"/);
  assert.match(adminHtml, /cursor-pointer/);
  assert.doesNotMatch(adminHtml, />Thao tác<\/button>/);
});

test("unnotified fees can be recorded as paid without a prior notification", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Ghi nhận đã nộp/);
  assert.doesNotMatch(source, /Cần đánh dấu đã báo trước/);
});

test("paid fee actions use the shared refund icon", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<RefundIcon className="h-\[18px\] w-\[18px\]"/);
  assert.doesNotMatch(source, /HandCoins/);
});

test("opening a paid action workspace prepares refund history in the background", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onPrepareRefundHistory: \(group: StudentFeeGroup\) => void/);
  assert.match(source, /if \(activeTab === "paid"\) \{[\s\S]*onPrepareRefundHistory\(group\)/);
  assert.match(source, /onClick=\{isAdmin \? \(\) => openActionWorkspace\(group\) : undefined\}/);
});

test("fee workspace previews the exact Zalo message and embeds refund work", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );
  const refundSource = readFileSync(
    new URL("../src/components/fees/fee-refund-dialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Nội dung Zalo dành cho \{group\.student_name\}/);
  assert.match(source, /actionProps\.getCopyMessage\(group\)/);
  assert.match(source, /<FeeMessageCodeEditor/);
  assert.match(source, /value=\{previewText\}/);
  assert.match(source, /onChange=\{onChangePreviewText\}/);
  assert.match(source, /actionProps\.onCopy\(group, canonicalMessage\)/);
  assert.match(source, /copyDraft !== copyBase/);
  assert.match(source, /actionProps\.onSaveCopy\(group, copyDraft\)/);
  assert.match(source, /LoadingLabel label="Đang lưu"/);
  assert.match(source, /actionProps\.refundPanel\(onClose\)/);
  assert.doesNotMatch(source, /bg-red-50 text-red-700 hover:bg-red-100/);
  assert.match(source, /bg-red-600 text-white hover:bg-red-700/);
  assert.match(refundSource, /export function FeeRefundPanel/);
  assert.match(refundSource, /without a second modal shell/);
});

test("fee action footer stays focused on the current action", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /<FormDialogFooter[\s\S]*?variant="ghost"[\s\S]*?Xem khoản thu[\s\S]*?right=/,
  );
});

test("payment reversal remains explicit in the contextual action workspace", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );
  const guardSource = readFileSync(
    new URL("../src/components/providers/action-selection-guard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const isUnpayDisabled = actionProps\.disabled \|\| group\.refunded_amount > 0/);
  assert.match(source, /disabled: isUnpayDisabled/);
  assert.match(source, /aria-disabled=\{item\.disabled \|\| undefined\}/);
  assert.match(source, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(source, /execute: \(\) => actionProps\.onUnpay\(group\)/);
  assert.match(source, /Hoàn tác đã nộp/);
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
  assert.match(source, /FeeActionWorkspace/);
  assert.match(source, /w-max max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(source, /whitespace-nowrap/);
  assert.match(source, /sm:max-w-\[640px\]/);
  assert.match(source, /sm:h-\[min\(680px,calc\(100dvh-2rem\)\)\]/);
  assert.match(source, /workspace-action-rail-in absolute left-full top-0/);
  assert.match(source, /aria-controls="fee-workspace-panel"/);
});

test("fee workspace prepares the selected student's Zalo template before opening the editor", () => {
  const source = readFileSync(
    new URL("../src/components/fees/fees-table.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /if \(mode === "copy"\) \{\s*try \{\s*copyPreview = actionProps\.getCopyMessage\(group\)/,
  );
  assert.match(source, /copyPreview = actionProps\.getCopyMessage\(group\)/);
  assert.match(source, /if \(nextMode === "copy"\) \{\s*setCopyDraft\(copyPreview \?\? ""\)/);
});

test("fee table gives the three date and amount columns more breathing room", () => {
  const adminGrid = getFeesTableGridClass({ isAdmin: true });

  assert.match(adminGrid, /minmax\(145px,1fr\)/);
  assert.match(adminGrid, /minmax\(150px,1\.08fr\)_118px_118px_124px/);
  assert.doesNotMatch(adminGrid, /_110px_110px_116px_/);
});
