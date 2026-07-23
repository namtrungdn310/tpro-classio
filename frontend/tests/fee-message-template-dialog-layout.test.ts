import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialogSource = readFileSync(
  new URL(
    "../src/components/fees/fee-message-template-dialog.tsx",
    import.meta.url,
  ),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../src/components/fees/fee-template-editor.tsx", import.meta.url),
  "utf8",
);

test("Zalo template dialog keeps both editors balanced at the expanded desktop width", () => {
  assert.match(dialogSource, /w-full max-w-\[1100px\]/);
  assert.match(dialogSource, /grid gap-5 lg:grid-cols-2/);
  assert.match(dialogSource, /min-w-0/);
});

test("Zalo template dialog omits redundant usage descriptions", () => {
  assert.doesNotMatch(dialogSource, /Dùng khi/);
});

test("Zalo template errors follow the shared edit, blur, and submit lifecycle", () => {
  assert.match(dialogSource, /useFormFieldFeedback\(TEMPLATE_FIELDS\)/);
  assert.match(dialogSource, /markInput\(field, value\)/);
  assert.match(dialogSource, /onBlur=\{\(\) => markBlur\(config\.field\)\}/);
  assert.match(dialogSource, /markSubmitted\(\)/);
  assert.match(
    dialogSource,
    /shouldShowError\(config\.field, isSubmitted\)/,
  );
  assert.match(editorSource, /onBlur\?\.\(\)/);
});

test("Zalo unsaved notice is gated by current schema validity and save state", () => {
  assert.match(
    dialogSource,
    /const hasErrors = validation\.data === null/,
  );
  assert.match(dialogSource, /hasChanges=\{hasPersistableChanges\}/);
  assert.match(dialogSource, /validation\.data\.payment_reminder_template/);
  assert.match(dialogSource, /hasErrors=\{hasErrors\}/);
  assert.match(dialogSource, /isSaving=\{isSaving\}/);
});

test("Zalo template retry rebases the optimistic version after a refetch", () => {
  assert.match(dialogSource, /const \[baseVersion, setBaseVersion\]/);
  assert.match(dialogSource, /setBaseVersion\(templates\.version\)/);
  assert.match(dialogSource, /version: baseVersion/);
});
