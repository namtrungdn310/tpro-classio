import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dividerSource = source("../src/components/ui/inline-field-divider.tsx");
const splitFieldSource = source("../src/components/ui/split-text-field.tsx");
const globalStyles = source("../src/app/globals.css");
const scheduleSource = source("../src/components/classes/class-schedule-list.tsx");
const classFormSource = source("../src/components/classes/class-form-dialog.tsx");
const studentSource = source("../src/app/(dashboard)/students/page.tsx");
const staffSource = source("../src/components/staff/staff-form-dialog.tsx");

test("compact form dividers share the exact classes used by class schedules", () => {
  assert.match(dividerSource, /inline-field-divider pointer-events-none block shrink-0/);
  assert.doesNotMatch(dividerSource, /CompoundFieldDivider/);
  assert.match(globalStyles, /--inline-field-divider-width: (?:[12](?:\.[0-9]+)?px|2px)/);
  assert.match(globalStyles, /--inline-field-divider-height: 1rem/);
  assert.match(globalStyles, /--inline-field-divider-color: #64748b/);
  assert.match(globalStyles, /--split-text-field-divider-zone: 2\.5rem/);
  assert.doesNotMatch(globalStyles, /--split-text-field-divider-width/);
  assert.doesNotMatch(globalStyles, /--split-text-field-divider-color/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*width: var\(--inline-field-divider-width\)/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*box-sizing: border-box/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*border: 0/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*opacity: 1/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*height: var\(--inline-field-divider-height\)/);
  assert.match(globalStyles, /\.inline-field-divider[\s\S]*background-color: var\(--inline-field-divider-color\)/);
  assert.match(splitFieldSource, /export function SplitTextField/);
  assert.match(splitFieldSource, /import \{ InlineFieldDivider \}/);
  assert.match(splitFieldSource, /left: ReactNode/);
  assert.match(splitFieldSource, /right: ReactNode/);
  assert.match(splitFieldSource, /split-text-field-divider-zone pointer-events-none flex h-full items-center justify-center/);
  assert.match(splitFieldSource, /<InlineFieldDivider \/>/);
  assert.match(dividerSource, /<span[\s\S]*aria-hidden="true"/);
  assert.match(dividerSource, /inline-field-divider/);
  assert.doesNotMatch(globalStyles, /border-left:/);
  assert.doesNotMatch(globalStyles, /border-right:/);
  assert.match(scheduleSource, /<InlineFieldDivider/);
  assert.match(classFormSource, /TeacherSlide/);
  assert.match(classFormSource, /isTeacherSlideOpen/);
  assert.match(classFormSource, /setIsTeacherSlideOpen\(true\)/);
  assert.match(studentSource, /<SplitTextField/);
  assert.match(staffSource, /<SplitTextField/);
  assert.doesNotMatch(studentSource, /compound-text-field/);
  assert.doesNotMatch(staffSource, /compound-text-field/);
  assert.doesNotMatch(studentSource, /<CompoundFieldDivider/);
  assert.doesNotMatch(staffSource, /<CompoundFieldDivider/);
  assert.doesNotMatch(studentSource, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(staffSource, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(studentSource, /grid-cols-\[minmax\(0,1fr\)_1px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(staffSource, /grid-cols-\[minmax\(0,1fr\)_1px_minmax\(0,1fr\)\]/);
  assert.match(
    scheduleSource,
    /grid-cols-\[var\(--inline-field-divider-width\)_minmax\(0,1fr\)\]/,
  );
  assert.doesNotMatch(scheduleSource, /w-\[1\.5px\]/);
  assert.doesNotMatch(studentSource, /translate-x-1\/2|left-1\/2/);
});
