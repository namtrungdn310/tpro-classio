import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const keyboardFocusSource = readFileSync(
  new URL("../src/lib/forms/keyboard-focus.ts", import.meta.url),
  "utf8",
);
const classDialogSource = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);
const moneyInputSource = readFileSync(
  new URL("../src/components/ui/smart-money-input.tsx", import.meta.url),
  "utf8",
);

test("keyboard focus collapses the selection to the end without touching mouse focus", () => {
  assert.match(keyboardFocusSource, /export function collapseSelectionOnKeyboardFocus/);
  assert.match(keyboardFocusSource, /event\.nativeEvent\.detail === 0/);
  assert.match(keyboardFocusSource, /setSelectionRange\(input\.value\.length, input\.value\.length\)/);
});

test("numeric class form fields collapse selection on keyboard focus", () => {
  assert.match(classDialogSource, /onFocus=\{collapseSelectionOnKeyboardFocus\}/);
  assert.equal(
    (classDialogSource.match(/onFocus=\{collapseSelectionOnKeyboardFocus\}/g) ?? []).length,
    3,
  );
  assert.match(classDialogSource, /id="class-duration-weeks"/);
  assert.match(classDialogSource, /id="class-package-count"/);
  assert.match(classDialogSource, /id="class-total-months"/);
});

test("smart money input also collapses selection on keyboard focus", () => {
  assert.match(moneyInputSource, /collapseSelectionOnKeyboardFocus/);
  assert.match(
    moneyInputSource,
    /onFocus=\{\(event\) => \{\s*setIsFocused\(true\);\s*collapseSelectionOnKeyboardFocus\(event\);\s*\}\}/,
  );
});

test("course total weeks multiplies duration by package count and hides on error", () => {
  assert.match(classDialogSource, /getCourseShortcutTotalWeeks/);
  assert.match(classDialogSource, /Tổng số tuần: \{totalCourseWeeks === null/);
  assert.doesNotMatch(classDialogSource, /derivedCoursePackage/);
  assert.match(classDialogSource, /id="class-total-weeks"/);
  assert.match(classDialogSource, /id="class-billing-cycle-error"/);
  assert.match(classDialogSource, /min-h-\[18px\]/);
  assert.doesNotMatch(
    classDialogSource,
    /<FormField error=\{billingCycleError\} label="Thời lượng và tổng số gói"/,
  );
});

test("the weeks input announces the helper or the error line", () => {
  assert.match(
    classDialogSource,
    /aria-describedby=\{\s*billingCycleError\s*\?\s*"class-billing-cycle-error"\s*:\s*"class-total-weeks"\s*\}/,
  );
  assert.match(
    classDialogSource,
    /id="class-duration-weeks"[\s\S]{0,500}aria-describedby=\{\s*billingCycleError/,
  );
});

test("end date errors appear under the end date field", () => {
  assert.doesNotMatch(
    classDialogSource,
    /controlId="class-total-months" error=\{endDateError\}/,
  );
  assert.match(
    classDialogSource,
    /controlId="class-end-date" error=\{endDateError\} label="Ngày kết thúc"/,
  );
  assert.equal(
    (classDialogSource.match(/controlId="class-end-date" error=\{endDateError\}/g) ?? []).length,
    2,
  );
  assert.match(
    classDialogSource,
    /aria-describedby=\{endDateError \? "class-end-date-error" : undefined\}/,
  );
  assert.doesNotMatch(classDialogSource, /Ngày kết thúc tối thiểu/);
});

test("hand-written notice boxes are replaced by shared components", () => {
  assert.doesNotMatch(classDialogSource, /<FormWarning|FormWarning>/);
  assert.doesNotMatch(classDialogSource, /<FormError/);
  assert.doesNotMatch(
    classDialogSource,
    /@\/components\/ui\/form-warning"|@\/components\/ui\/form-error"/,
  );
  assert.match(classDialogSource, /<FormNotice\s+tone="warning">Lớp chưa được phân loại/);
  assert.match(classDialogSource, /<InlineFormError/);
  assert.doesNotMatch(
    classDialogSource,
    /rounded-md border border-amber-200 bg-amber-50 px-3 py-2/,
  );
  assert.doesNotMatch(
    classDialogSource,
    /helper-text rounded-md border border-destructive\/15 bg-destructive-soft px-3 py-2 text-destructive/,
  );
});

test("end date preview retry is a plain button that refetches and never submits", () => {
  assert.match(
    classDialogSource,
    /type="button"[\s\S]{0,200}disabled=\{endDatePreviewQuery\.isFetching\}[\s\S]{0,200}onClick=\{\(\) => void endDatePreviewQuery\.refetch\(\)\}/,
  );
  assert.match(classDialogSource, /<LoadingLabel label="Đang thử lại" \/>/);
});

test("staff submit error sits inside the scrollable body above the footer", () => {
  const staffSource = readFileSync(
    new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(staffSource, /<InlineFormError className="mt-3">\{submitError\}<\/InlineFormError>/);
  assert.match(
    staffSource,
    /submitError \? \([\s\S]{0,200}<InlineFormError[\s\S]{0,300}<\/FormDialogBody>/,
  );
});
