import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeeReportPanel } from "../src/components/fees/fee-report-panel";

test("fee summary keeps status filters and class filtering in one compact toolbar", () => {
  const html = renderToStaticMarkup(
    createElement(FeeReportPanel, {
      activeClassId: "",
      activeTab: "unpaid",
      classItems: Array.from({ length: 19 }, (_, index) => ({
        id: `class-${index}`,
        name: index === 0 ? "IELTS Chuyên sâu" : `${index + 1}C1`,
        paidStudentCount: 2,
        totalAmount: 1_500_000,
        unpaidStudentCount: 3,
      })),
      onChangeClass: () => undefined,
      onChangeTab: () => undefined,
      onChangeUnpaidStage: () => undefined,
      scopeLabel: "Tháng 7/2026",
      summary: {
        grossCollected: 16_000_000,
        netCollected: 15_000_000,
        notified: 3,
        outstanding: 12_000_000,
        paid: 4,
        refunded: 1_000_000,
        recordCount: 12,
        total: 27_000_000,
        unnotified: 5,
      },
      unpaidStage: "unnotified",
    }),
  );

  assert.match(html, /Khoản thu kỳ hiện tại/);
  assert.match(html, /Tháng 7\/2026/);
  assert.match(html, /15\.000\.000đ/);
  assert.match(html, /27\.000\.000đ/);
  assert.match(html, /Chưa thu 12\.000\.000đ/);
  assert.match(html, /Đã hoàn 1\.000\.000đ/);
  assert.match(html, /Chưa báo/);
  assert.match(html, /Đã báo/);
  assert.match(html, /Đã nộp/);
  assert.match(html, /Lọc khoản thu theo lớp/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="56"/);
  assert.match(html, /aria-label="Lọc theo trạng thái khoản thu"/);
  assert.match(html, /aria-label="Chưa báo: 5 khoản"/);
  assert.doesNotMatch(html, />01</);
  assert.doesNotMatch(html, />02</);
  assert.doesNotMatch(html, />03</);
  assert.match(html, /Tất cả lớp \(19\)/);
  assert.match(html, />IELTS Chuyên sâu · 3 chưa nộp</);
  assert.doesNotMatch(html, /h-\[172px\]|grid-flow-col|Xem các lớp ở trang sau/);
  assert.doesNotMatch(html, /bg-(?:rose|amber|emerald)-50\b/);
  assert.doesNotMatch(html, /rounded-full text-\[11px\].*>01</);
});
