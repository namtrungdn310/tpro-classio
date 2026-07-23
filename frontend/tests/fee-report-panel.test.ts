import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeeReportPanel } from "../src/components/fees/fee-report-panel";

test("fee class filter keeps three full-width rows and uses explicit page controls", () => {
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

  assert.match(html, /h-\[172px\]/);
  assert.match(html, /grid-flow-col/);
  assert.match(html, /grid-template-rows:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /aria-label="Xem các lớp ở trang trước"[^>]*disabled/);
  assert.match(html, /aria-label="Xem các lớp ở trang sau"/);
  assert.match(
    html,
    /aria-label="Xem các lớp ở trang sau"\s+aria-controls="[^"]+"\s+class=/,
  );
  assert.doesNotMatch(html, /overflow-x-auto|overscroll-x-contain|touch-pan-x|snap-proximity/);
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, />IELTS Chuyên sâu</);
  assert.doesNotMatch(html, />IELTS CS</);
  assert.match(html, /title="IELTS Chuyên sâu"/);
  assert.match(html, /aria-label="IELTS Chuyên sâu:/);
  assert.match(html, /15\.000\.000đ \/ 27\.000\.000đ/);
  assert.match(
    html,
    /Đã nhận 16\.000\.000đ · Đã hoàn\s*1\.000\.000đ<\/span><span class="block">Còn phải thu 12\.000\.000đ<\/span>/,
  );
  assert.doesNotMatch(html, /· Còn phải thu/);
});
