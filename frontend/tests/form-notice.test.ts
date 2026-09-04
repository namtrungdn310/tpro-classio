import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../src/components/ui/form-notice.tsx", import.meta.url),
  "utf8",
);
const studentsSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const unsavedChangesSource = readFileSync(
  new URL("../src/components/ui/unsaved-changes-notice.tsx", import.meta.url),
  "utf8",
);

test("form notices share the info/warning presentation and icon contract", () => {
  assert.match(componentSource, /role=\{loading \? "status" : "note"\}/);
  assert.match(componentSource, /border-primary\/15 bg-primary-soft/);
  assert.match(componentSource, /Lưu ý:/);
  assert.match(componentSource, /RiInformationLine/);
  assert.match(componentSource, /RiAlertLine/);
  assert.match(componentSource, /RiLoader4Line/);
  assert.match(componentSource, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(componentSource, /animate-spin motion-reduce:animate-none/);
  assert.match(componentSource, /border-amber-200 bg-amber-50/);
  assert.match(componentSource, /aria-hidden="true"/);
});

test("inline form error is a compact red line without a box", () => {
  const errorSource = readFileSync(
    new URL("../src/components/ui/inline-form-error.tsx", import.meta.url),
    "utf8",
  );
  assert.match(errorSource, /role="alert"/);
  assert.match(errorSource, /text-destructive/);
  assert.doesNotMatch(errorSource, /bg-destructive-soft/);
  assert.doesNotMatch(errorSource, /border-destructive\/15/);
  assert.match(errorSource, /RiErrorWarningLine/);
  assert.match(errorSource, /action\?: ReactNode/);
});

test("student transfer guidance uses the shared blue notice", () => {
  assert.match(studentsSource, /<FormNotice>/);
  assert.match(studentsSource, /Lưu xong, học viên sẽ rời lớp hiện tại\./);
  assert.doesNotMatch(studentsSource, /FormNotice className="whitespace-nowrap"/);
  assert.doesNotMatch(studentsSource, />\s*\* Lưu xong/);
});

test("unsaved changes use a shared icon-and-text line without a warning surface", () => {
  assert.match(unsavedChangesSource, /RiAlertLine/);
  assert.match(unsavedChangesSource, /message\?: ReactNode/);
  assert.doesNotMatch(unsavedChangesSource, /border-amber-200 bg-amber-50/);
  assert.doesNotMatch(
    unsavedChangesSource,
    /rounded-md border border-amber-200 bg-amber-50 px-3 py-2/,
  );
});
