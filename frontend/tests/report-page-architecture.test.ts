import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportPage = readFileSync(
  new URL("../src/app/(dashboard)/report/page.tsx", import.meta.url),
  "utf8",
);
const reconciliationPanel = readFileSync(
  new URL("../src/components/reports/payment-reconciliation-panel.tsx", import.meta.url),
  "utf8",
);

test("report page separates receipts, activity and reconciliation", () => {
  assert.match(reportPage, /type ReportView = "receipts" \| "operations" \| "reconciliation"/);
  assert.match(reportPage, /aria-label="Nội dung báo cáo học phí"/);
  assert.match(reportPage, /<FeeOperationPanel/);
  assert.match(reportPage, /<PaymentReconciliationPanel/);
  assert.match(reportPage, /label="Sổ thu"/);
  assert.match(reportPage, /label="Nhật ký học phí"/);
  assert.match(reportPage, /label="Giao dịch cần kiểm tra"/);
  assert.doesNotMatch(reportPage, /<ReportTab icon=/);
});

test("reconciliation requires an explicit action and never auto-accepts review rows", () => {
  assert.match(reconciliationPanel, /Ghép yêu cầu/);
  assert.match(reconciliationPanel, /Thử khớp lại/);
  assert.match(reconciliationPanel, /Bỏ qua giao dịch này\?/);
  assert.match(reconciliationPanel, /function canRecordPayment/);
  assert.match(reconciliationPanel, /transfer_type/);
  assert.match(reconciliationPanel, /result_code/);
  assert.match(reconciliationPanel, /Chỉ giao dịch chưa khớp mới xuất hiện tại đây/);
});
