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
  assert.match(source, /onClick=\{\(\) => setDatePickerTarget\("start"\)\}/);
});

test("class metadata and package timing keep compact equal columns", () => {
  assert.match(source, /minmax\(0,1fr\)_minmax\(0,1fr\)/);
  assert.match(source, /label="Khối lớp"/);
  assert.match(source, /label="Năm học"/);
  assert.match(source, /label="Thời lượng mỗi gói"/);
  assert.match(source, /label="Ngày bắt đầu"/);
  assert.match(source, /label="Ngày kết thúc"/);
});

test("month and package counts are optional shortcuts while end date stays editable", () => {
  assert.doesNotMatch(source, /getClassMinimumEndDate|minimumEndDate/);
  assert.match(source, /setDatePickerTarget\("end"\)/);
  assert.match(source, /id="class-total-months"/);
  assert.match(source, /id="class-package-count"/);
  assert.match(source, /applyEndDateShortcut/);
  assert.match(source, /onSelectDate=\{applySelectedEndDate\}/);
  assert.match(source, /Tổng số tuần:/);
});

test("combined grade and academic year selectors do not render extra arrow icons", () => {
  assert.doesNotMatch(source, /ChevronDown/);
  assert.match(source, /controlId="class-grade"[\s\S]*?label="Khối lớp"/);
  assert.match(source, /controlId="class-academic-year"[\s\S]*?label="Năm học"/);
});

test("start date picker uses one year of future options", () => {
  assert.match(source, /yearOptions=\{getClassDatePickerYears\(1\)\}/);
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
