import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);

test("new course forms do not invent a package duration", () => {
  assert.match(source, /billing_cycle_weeks: null/);
  assert.doesNotMatch(source, /billingCycleWeeks \?\? 12/);
});

test("new classes start from the current Vietnam business date by default", () => {
  assert.match(source, /start_date:\s*getVietnamTodayIso\(\)/);
  assert.match(source, /<ManualDateInput[\s\S]*?id="class-start-date"/);
});

test("class metadata and open-ended package timing keep compact equal columns", () => {
  assert.match(source, /minmax\(0,1fr\)_minmax\(0,1fr\)/);
  assert.match(source, /label="Khối lớp"/);
  assert.match(source, /label="Năm học"/);
  assert.match(source, /label="Thời lượng mỗi gói"/);
  assert.match(source, /label="Ngày bắt đầu"/);
  assert.doesNotMatch(source, /label="Ngày kết thúc"/);
});

test("class form has no end-date shortcuts or hidden end-date controls", () => {
  assert.doesNotMatch(source, /end_date|endDate|Ngày kết thúc/);
  assert.doesNotMatch(source, /class-total-months|class-package-count/);
});

test("combined grade and academic year selectors do not render extra arrow icons", () => {
  assert.doesNotMatch(source, /ChevronDown/);
  assert.match(source, /controlId="class-grade"[\s\S]*?label="Khối lớp"/);
  assert.match(source, /controlId="class-academic-year"[\s\S]*?label="Năm học"/);
});

test("class start date uses the shared manual date control", () => {
  assert.match(source, /value=\{startDate \?\? null\}/);
  assert.match(source, /Ngày bắt đầu không hợp lệ/);
  assert.doesNotMatch(source, /DatePickerSlide|datePickerTarget/);
});

test("an incomplete class start date stays a draft until it is valid", () => {
  assert.match(source, /start_date:\s*comparableManualDate\(/);
  assert.match(source, /hasCommittedStartDateChange/);
});

test("class form rows share one equal column ratio and IELTS start date fills its row", () => {
  assert.match(
    source,
    /const CLASS_FORM_COLUMNS = "sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]"/,
  );
  assert.match(source, /className="min-w-0 sm:col-span-2"/);
  assert.match(
    source,
    /classCategory === "IELTS" && "sm:col-span-2"/,
  );
});
