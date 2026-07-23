import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dividerSource = source("../src/components/ui/inline-field-divider.tsx");
const globalStyles = source("../src/app/globals.css");
const scheduleSource = source("../src/components/classes/class-schedule-list.tsx");
const classFormSource = source("../src/components/classes/class-form-dialog.tsx");
const studentSource = source("../src/app/(dashboard)/students/page.tsx");
const staffSource = source("../src/components/staff/staff-form-dialog.tsx");
const feesSource = source("../src/app/(dashboard)/fees/page.tsx");

test("compact form dividers share the exact classes used by class schedules", () => {
  assert.match(dividerSource, /inline-field-divider pointer-events-none block shrink-0/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*width: 1\.6px/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*min-width: 1\.6px/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*max-width: 1\.6px/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*height: 1rem/);
  assert.match(globalStyles, /background: #111827/);
  assert.doesNotMatch(globalStyles, /border-left:/);
  assert.doesNotMatch(globalStyles, /border-right:/);
  assert.match(scheduleSource, /<InlineFieldDivider/);
  assert.match(classFormSource, /teachers\.map[\s\S]*<InlineFieldDivider className="self-center"/);
  assert.match(classFormSource, /max-h-28[\s\S]*px-1\.5 py-0\.5/);
  assert.match(studentSource, /<InlineFieldDivider/);
  assert.match(staffSource, /<InlineFieldDivider/);
  assert.match(feesSource, /<InlineFieldDivider/);
  assert.doesNotMatch(scheduleSource, /w-\[1\.5px\]/);
  assert.doesNotMatch(studentSource, /translate-x-1\/2|left-1\/2/);
});
