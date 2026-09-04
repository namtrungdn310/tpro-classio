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
const studentPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const formTextControlSource = readFileSync(
  new URL("../src/components/ui/form-text-control.ts", import.meta.url),
  "utf8",
);
const segmentedControlSource = readFileSync(
  new URL("../src/components/ui/segmented-control.tsx", import.meta.url),
  "utf8",
);
const authFieldSource = readFileSync(
  new URL("../src/components/ui/auth-field.tsx", import.meta.url),
  "utf8",
);
const otpInputSource = readFileSync(
  new URL("../src/components/ui/otp-input.tsx", import.meta.url),
  "utf8",
);
const feeMessageEditorSource = readFileSync(
  new URL("../src/components/fees/fee-message-code-editor.tsx", import.meta.url),
  "utf8",
);
const buttonSource = readFileSync(
  new URL("../src/components/ui/button.tsx", import.meta.url),
  "utf8",
);
const staffFormSource = readFileSync(
  new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
  "utf8",
);
const feeRefundSource = readFileSync(
  new URL("../src/components/fees/fee-refund-dialog.tsx", import.meta.url),
  "utf8",
);
const loginTotpSource = readFileSync(
  new URL("../src/app/login/totp/page.tsx", import.meta.url),
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
    1,
  );
  assert.match(classDialogSource, /id="class-duration-weeks"/);
  assert.doesNotMatch(classDialogSource, /id="class-package-count"|id="class-total-months"/);
});

test("smart money input also collapses selection on keyboard focus", () => {
  assert.match(moneyInputSource, /collapseSelectionOnKeyboardFocus/);
  assert.match(
    moneyInputSource,
    /onFocus=\{\(event\) => \{\s*setIsFocused\(true\);\s*collapseSelectionOnKeyboardFocus\(event\);\s*\}\}/,
  );
});

test("invalid controls keep the destructive focus treatment while editing", () => {
  assert.match(formTextControlSource, /focus:!border-destructive/);
  assert.match(formTextControlSource, /focus:!ring-destructive\/15/);
  assert.match(studentPageSource, /focus-within:!border-destructive/);
  assert.match(studentPageSource, /focus-within:!ring-destructive\/15/);
  assert.match(segmentedControlSource, /focus-visible:!ring-destructive\/30/);
  assert.match(feeRefundSource, /reversalError && formTextControlErrorClassName/);
  assert.match(loginTotpSource, /error && authErrorInputClassName/);
});

test("form controls use a thin focus ring consistently", () => {
  assert.match(formTextControlSource, /focus:ring-1 focus:ring-primary\/15/);
  assert.match(authFieldSource, /focus:ring-1 focus:ring-gray-200/);
  assert.match(otpInputSource, /focus:ring-1 focus:ring-gray-200/);
  assert.match(studentPageSource, /focus-within:ring-1/);
  assert.match(staffFormSource, /focus-within:ring-1/);
  assert.match(feeMessageEditorSource, /focus-within:ring-1/);
  assert.match(buttonSource, /focus-visible:ring-2 focus-visible:ring-ring\/50/);
  assert.doesNotMatch(buttonSource, /focus-visible:ring-3|aria-invalid:ring-3/);
  assert.match(segmentedControlSource, /ring-1 ring-destructive\/15/);
  assert.match(segmentedControlSource, /focus-visible:ring-1 focus-visible:ring-inset/);
  assert.match(feeRefundSource, /formTextControlErrorClassName/);
  assert.doesNotMatch(formTextControlSource, /focus:ring-2/);
  assert.doesNotMatch(studentPageSource, /focus-within:ring-2/);
});

test("course form keeps only the recurring package duration", () => {
  assert.match(classDialogSource, /label="Thời lượng mỗi gói"/);
  assert.match(classDialogSource, /id="class-duration-weeks"/);
  assert.doesNotMatch(classDialogSource, /class-total-weeks|class-package-count|getCourseShortcutTotalWeeks/);
});

test("the weeks input stays inside the shared error field", () => {
  assert.match(classDialogSource, /<FormField controlId="class-duration-weeks" error=\{billingCycleError\}/);
});

test("the obsolete end-date error field is absent", () => {
  assert.doesNotMatch(classDialogSource, /endDateError|class-end-date|Ngày kết thúc/);
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

test("class form removes the obsolete end-date preview flow", () => {
  assert.doesNotMatch(classDialogSource, /endDatePreview|previewClassEndDate|end_date/);
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
