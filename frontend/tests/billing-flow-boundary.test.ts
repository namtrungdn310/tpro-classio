import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("billing date editor only opens review after a changed valid date", () => {
  const source = read("src/components/students/billing-date-field.tsx");
  assert.match(source, /if \(!changed \|\| !valid\) return/);
  assert.match(source, /\{changed && <Button/);
  assert.match(source, /onPendingChange\?\.\(enrollmentId, changed\)/);
  assert.doesNotMatch(source, /mode: "VIEW"|onDetails/);
});

test("financial review has no report components or listing requests", () => {
  const source = read("src/components/students/billing-schedule-dialog.tsx");
  assert.doesNotMatch(source, /BillingFeesBrowser|BillingFeesTable|ScheduleViewMode|initial\.history|Xem lịch hiện tại/);
  assert.match(source, /Khoản sẽ được thay thế/);
  assert.match(source, /matchesAcceptedPlan/);
  assert.match(source, /expected_preview_fingerprint/);
  assert.equal(existsSync(resolve(process.cwd(), "src/components/students/billing-fees-browser.tsx")), false);
  assert.equal(existsSync(resolve(process.cwd(), "src/components/students/billing-fees-table.tsx")), false);
});

test("report owns list/history queries while date state remains lean", () => {
  const api = read("src/lib/api/billing-dates.ts");
  const stateSchema = api.slice(api.indexOf("export const billingScheduleSchema"), api.indexOf("export const billingSchedulePreviewSchema"));
  assert.doesNotMatch(stateSchema, /history|fees/);
  assert.doesNotMatch(api, /billingFeePageSchema|getBillingFeePage/);
  assert.match(read("src/lib/api/billing-reports.ts"), /\/reports\/billing\/enrollments/);
  assert.match(read("src/app/(dashboard)/report/page.tsx"), /<BillingScheduleReport/);
});

test("billing date field displays current and next cycle note below billing anchor input", () => {
  const source = read("src/components/students/billing-date-field.tsx");
  const pageSource = read("src/app/(dashboard)/students/page.tsx");

  // Cycle props on BillingDateField
  assert.match(source, /currentPeriod\?: string \| null/);
  assert.match(source, /nextPeriod\?: string \| null/);
  assert.match(source, /currentFeeStatus\?: "PAID" \| "UNPAID" \| null/);

  // Label text matching user specification
  assert.match(source, /Kỳ hiện tại:/);
  assert.match(source, /Kỳ sau:/);
  assert.match(source, /currentFeeStatus === "PAID"/);

  // Integration in EnrollmentFeeSection
  assert.match(pageSource, /currentPeriod=\{enrollment\.current_period\}/);
  assert.match(pageSource, /nextPeriod=\{enrollment\.next_period\}/);
  assert.match(pageSource, /currentFeeStatus=\{enrollment\.current_fee_status\}/);

  // Schemas preserve cycle info
  const studentSchemaSource = read("src/lib/schemas/student.ts");
  assert.match(studentSchemaSource, /current_period:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(studentSchemaSource, /next_period:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);

  const billingDatesSource = read("src/lib/api/billing-dates.ts");
  assert.match(billingDatesSource, /current_period:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(billingDatesSource, /next_period:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);

  // Hint "Bấm Xử lý thay đổi để chọn và xác nhận phương án" is removed
  assert.doesNotMatch(source, /xác nhận phương án/i);
});

test("formatCyclePeriod formats specific day/month/year dates", async () => {
  const { formatCyclePeriod } = await import("../src/components/students/billing-date-field");

  assert.equal(formatCyclePeriod("2026-08-04"), "04/08/2026");
  assert.equal(formatCyclePeriod("2026-01-01"), "01/01/2026");
  assert.equal(formatCyclePeriod("2026-09-04"), "04/09/2026");
  assert.equal(formatCyclePeriod("2026-08", "2026-08-04"), "04/08/2026");
  assert.equal(formatCyclePeriod("2026-01", "01/01/2026"), "01/01/2026");
  assert.equal(formatCyclePeriod("04/08/2026"), "04/08/2026");
  assert.equal(formatCyclePeriod(null), null);
  assert.equal(formatCyclePeriod(undefined), null);
});

