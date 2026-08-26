import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const globalStyles = source("../src/app/globals.css");
const formSection = source("../src/components/ui/form-section.tsx");
const studentsPage = source("../src/app/(dashboard)/students/page.tsx");
const classDialog = source("../src/components/classes/class-form-dialog.tsx");
const staffDialog = source("../src/components/staff/staff-form-dialog.tsx");
const templateDialog = source(
  "../src/components/fees/fee-message-template-dialog.tsx",
);
const feesTable = source("../src/components/fees/fees-table.tsx");
const feeReportPanel = source("../src/components/fees/fee-report-panel.tsx");
const reportPage = source("../src/app/(dashboard)/report/page.tsx");
const paidReceiptTable = source(
  "../src/components/reports/paid-receipt-table.tsx",
);
const paidReceiptDetail = source(
  "../src/components/reports/paid-receipt-detail.tsx",
);
const paidReportSummary = source(
  "../src/components/reports/paid-report-summary.tsx",
);
const dashboardSidebar = source(
  "../src/components/layout/dashboard-sidebar.tsx",
);
const headerFilters = source(
  "../src/components/layout/header-filter-controls.tsx",
);
const classHistory = source(
  "../src/components/classes/class-history-slide.tsx",
);
const earlyPaymentPanel = source(
  "../src/components/fees/early-payment-panel.tsx",
);

test("field labels stay subordinate to entered values while group labels remain prominent", () => {
  assert.match(
    globalStyles,
    /\.form-label-text\s*\{[\s\S]*?font-size: 0\.875rem;[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    globalStyles,
    /\.form-input-text\s*\{[\s\S]*?font-size: var\(--form-input-font-size\);[\s\S]*?font-weight: var\(--form-input-font-weight\);/,
  );
  assert.match(
    globalStyles,
    /\.form-section-title-text\s*\{[\s\S]*?font-size: 0\.875rem;[\s\S]*?font-weight: 700;/,
  );
  assert.match(formSection, /<h3[\s\S]*form-section-title-text/);
  assert.doesNotMatch(formSection, /uppercase|tracking-\[/);

  for (const dialogSource of [classDialog, templateDialog]) {
    assert.doesNotMatch(
      dialogSource,
      /form-label-text[^"\n]*text-\[15px\]/,
    );
  }

  assert.match(
    staffDialog,
    /<FormSection label="Thông tin liên hệ" order=\{2\}>[\s\S]*?label="Zalo và số điện thoại"/,
  );
  assert.equal(
    studentsPage.match(/form-label-text[^"\n]*text-\[15px\]/g)?.length,
    1,
  );
});

test("dense financial and audit views keep meaningful metadata readable", () => {
  assert.match(
    feesTable,
    /break-words text-base font-semibold text-gray-900/,
  );
  assert.doesNotMatch(feeReportPanel, /text-\[10px\]/);
  assert.match(
    feeReportPanel,
    /text-\[13px\] font-medium leading-5 text-gray-500/,
  );
  assert.doesNotMatch(reportPage, /text-\[11px\]/);

  for (const readableContent of [
    paidReceiptTable,
    paidReceiptDetail,
    paidReportSummary,
    dashboardSidebar,
    classHistory,
    earlyPaymentPanel,
  ]) {
    assert.doesNotMatch(readableContent, /text-\[(?:10|11)px\]/);
  }
});

test("filter labels use the shared table heading scale", () => {
  assert.match(headerFilters, /table-heading-text text-gray-500/);
  assert.doesNotMatch(
    headerFilters,
    /<p className="text-\[11px\] font-semibold uppercase text-gray-500"/,
  );
});
