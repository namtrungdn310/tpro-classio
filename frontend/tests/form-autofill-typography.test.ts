import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const loginTotpSource = readFileSync(
  new URL("../src/app/login/totp/page.tsx", import.meta.url),
  "utf8",
);
const otpInputSource = readFileSync(
  new URL("../src/components/ui/otp-input.tsx", import.meta.url),
  "utf8",
);
const refundDialogSource = readFileSync(
  new URL("../src/components/fees/fee-refund-dialog.tsx", import.meta.url),
  "utf8",
);
const studentsPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const classFormDialogSource = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);
const staffFormDialogSource = readFileSync(
  new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
  "utf8",
);
const appProvidersSource = readFileSync(
  new URL("../src/components/providers/app-providers.tsx", import.meta.url),
  "utf8",
);
const feeMessageEditorSource = readFileSync(
  new URL("../src/components/fees/fee-message-code-editor.tsx", import.meta.url),
  "utf8",
);
const loginSource = readFileSync(
  new URL("../src/app/login/page.tsx", import.meta.url),
  "utf8",
);
const registerSource = readFileSync(
  new URL("../src/app/register/page.tsx", import.meta.url),
  "utf8",
);
const resetPasswordSource = readFileSync(
  new URL("../src/app/reset-password/page.tsx", import.meta.url),
  "utf8",
);
const userAccessSource = readFileSync(
  new URL("../src/components/settings/user-access-panel.tsx", import.meta.url),
  "utf8",
);

test("shared form controls keep the same typography during browser autofill", () => {
  assert.match(globalStyles, /--form-input-font-family: var\(--font-body\), system-ui, sans-serif;/);
  assert.match(globalStyles, /--form-input-font-size: 0\.9375rem;/);
  assert.match(globalStyles, /--form-input-line-height: 1\.25rem;/);
  assert.match(globalStyles, /--form-input-font-weight: 500;/);
  assert.match(globalStyles, /\.form-input-text\s*\{[\s\S]*?font-family: var\(--form-input-font-family\)/);
  assert.match(globalStyles, /\.form-input-text\s*\{[\s\S]*?font-synthesis: none;/);
  assert.match(globalStyles, /\.form-input-text:-webkit-autofill\s*\{/);
  assert.match(globalStyles, /\.form-input-text:autofill\s*\{/);
  assert.match(
    globalStyles,
    /font-family: var\(--form-input-font-family\) !important;/,
  );
  assert.match(
    globalStyles,
    /font-size: var\(--form-input-font-size\) !important;/,
  );
  assert.match(
    globalStyles,
    /font-weight: var\(--form-input-font-weight\) !important;/,
  );
});

test("text-like one-off controls do not opt out of the shared caret contract", () => {
  assert.match(globalStyles, /\.otp-digit-text\s*\{[\s\S]*?font-family: var\(--form-input-font-family\)/);
  assert.match(globalStyles, /\.otp-digit-text\s*\{[\s\S]*?font-weight: var\(--form-input-font-weight\)/);
  assert.match(otpInputSource, /className=\{cn\(\s*"otp-digit-text/);
  assert.match(loginTotpSource, /className=\{cn\([\s\S]*?authInputClassName,[\s\S]*?"h-10"/);
  assert.doesNotMatch(loginTotpSource, /font-mono|tracking-widest/);
  assert.doesNotMatch(refundDialogSource, /form-input-text[^"`]*h-9/);
  assert.doesNotMatch(refundDialogSource, /focus:ring-gray-100/);
});

test("dashboard form input helpers derive from the same header search caret contract", () => {
  assert.match(studentsPageSource, /const inputClassName = `\$\{formTextControlClassName\} select-text`/);
  assert.match(studentsPageSource, /cn\(inputClassName,\s*hasError && formTextControlErrorClassName\)/);
  assert.match(studentsPageSource, /cn\(numberInputClassName,\s*hasError && formTextControlErrorClassName\)/);
  assert.doesNotMatch(
    studentsPageSource,
    /const formControlBaseClassName\s*=\s*"form-input-text h-8/,
  );

  assert.match(classFormDialogSource, /return cn\(formTextControlClassName,\s*hasError && formTextControlErrorClassName\)/);
  assert.match(staffFormDialogSource, /return cn\(formTextControlClassName,\s*hasError && formTextControlErrorClassName\)/);
  assert.match(refundDialogSource, /className=\{cn\(\s*formTextControlClassName,\s*"min-w-0 flex-1 sm:max-w-\[248px\]"/);
  assert.doesNotMatch(
    refundDialogSource,
    /className=\{`form-input-text h-8 min-w-0 flex-1/,
  );
});

test("all editable controls retain the browser-native caret", () => {
  assert.doesNotMatch(appProvidersSource, /UnifiedCaretProvider/);
  assert.doesNotMatch(globalStyles, /caret-color|form-caret|unified-form-caret/i);
  assert.doesNotMatch(feeMessageEditorSource, /caretColor|data-unified-caret/i);
});

test("editable email fields retain email keyboards while exposing measurable selections", () => {
  for (const source of [
    loginSource,
    registerSource,
    resetPasswordSource,
    userAccessSource,
  ]) {
    assert.doesNotMatch(source, /type="email"/);
  }

  assert.match(loginSource, /type="text"\s+inputMode="email"/);
  assert.match(registerSource, /type="text"\s+inputMode="email"/);
  assert.match(resetPasswordSource, /type="text"\s+inputMode="email"/);
  assert.match(userAccessSource, /type="text"\s+inputMode="email"/);
});

test("settings reveal releases its composited transform after the animation", () => {
  assert.match(globalStyles, /@keyframes settings-reveal[\s\S]*?to\s*\{[\s\S]*?transform: none;/);
  assert.match(globalStyles, /\.settings-reveal\s*\{\s*animation: settings-reveal 160ms ease-out;\s*\}/);
  assert.doesNotMatch(globalStyles, /animation: settings-reveal[^;]*\bboth\b/);
});

test("password controls keep shared weight and only widen native mask spacing", () => {
  assert.doesNotMatch(
    globalStyles,
    /\.password-input-native\s*\{[\s\S]*?--form-input-font-weight:/,
  );
  assert.match(
    globalStyles,
    /\.password-input-native\s*\{[\s\S]*?--form-input-letter-spacing: 0\.12em;/,
  );
});
