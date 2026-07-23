import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studentPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const classDialogSource = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);

test("student enrollment dates use a non-selectable display control", () => {
  assert.match(
    studentPageSource,
    /const datePickerButtonClassName = `\$\{formControlBaseClassName\} select-none text-left`/,
  );
  assert.match(
    studentPageSource,
    /className=\{`\$\{datePickerButtonClassName\} \$\{error \? "border-red-400 ring-2 ring-red-100" : ""\}`\}/,
  );
  assert.match(
    studentPageSource,
    /className=\{`\$\{datePickerButtonClassName\} \$\{privacyToggle \? "!pr-10" : ""\}`\}/,
  );
});

test("current-class panel blocks ambient selection but preserves class-name selection", () => {
  assert.match(
    studentPageSource,
    /className="select-none rounded-md border border-gray-200 bg-gray-50 p-2"/,
  );
  assert.match(
    studentPageSource,
    /className="inline-flex h-7 select-text items-center rounded-md border px-2 text-\[13px\] font-medium"/,
  );
});

test("class form dialog clips its footer to the rounded modal corners", () => {
  assert.match(
    classDialogSource,
    /className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl[^\"]*sm:rounded-xl"/,
  );
});
