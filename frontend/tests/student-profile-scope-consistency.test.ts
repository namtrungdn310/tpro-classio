import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);
const studentSkeletonSource = readFileSync(
  resolve(process.cwd(), "src/components/students/students-route-skeleton.tsx"),
  "utf8",
);

test("StudentProfileScope banner is synchronized with SelectedClassBar", () => {
  // Banner has rounded-lg, border-gray-200, shadow-[0_1px_2px_rgba(15,23,42,0.04)]
  assert.match(
    studentPageSource,
    /<div className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-\[0_1px_2px_rgba\(15,23,42,0\.04\)\]">[\s\S]*?<h1 className="font-ui min-w-0 text-base font-semibold leading-5 text-gray-950">\{labels\.title\}<\/h1>/,
  );
  assert.match(
    studentPageSource,
    /<p className="mt-0\.5 text-sm font-medium text-gray-500">Mã học viên được giữ nguyên trong suốt quá trình học\.<\/p>/,
  );
});

test("StudentProfileTable header uses system table-heading-text, bg-gray-100, and text-gray-800", () => {
  assert.match(
    studentPageSource,
    /const PROFILE_TABLE_GRID_CLASS = "grid grid-cols-5 gap-x-4";/,
  );
  assert.match(
    studentSkeletonSource,
    /const PROFILE_TABLE_GRID_CLASS = "grid grid-cols-5 gap-x-4";/,
  );
  assert.match(
    studentPageSource,
    /<div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-100">\s*<div role="row" className=\{`\$\{PROFILE_TABLE_GRID_CLASS\} table-heading-text text-left text-gray-800`\}>/,
  );
  assert.match(
    studentPageSource,
    /<div role="columnheader" className="whitespace-nowrap px-2\.5 py-3">Mã HV<\/div>/,
  );
  assert.match(
    studentPageSource,
    /<div role="columnheader" className="whitespace-nowrap px-2\.5 py-3">Họ tên<\/div>/,
  );
});

test("StudentProfileTable uses rounded-lg, divide-y divide-gray-200, and standard hover/focus states", () => {
  // Container rounded-lg
  assert.match(
    studentPageSource,
    /className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:h-full xl:min-h-0 xl:flex xl:flex-col"/,
  );
  // Rowgroup divide-y divide-gray-200
  assert.match(
    studentPageSource,
    /className="divide-y divide-gray-200 text-\[15px\] font-medium leading-5"/,
  );
  // Hover and focus-visible
  assert.match(
    studentPageSource,
    /hover:bg-gray-100\/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary\/30/,
  );
});

test("StudentProfileTable respects privacy masking for birth_date and school", () => {
  assert.match(
    studentPageSource,
    /isStudentFieldHidden\(student, "birth_date"\) \?\s*\(\s*<HiddenStudentValue \/>\s*\) :\s*\(\s*<SelectableStudentValue value=\{formatDate\(student\.birth_date\)\} \/>\s*\)/,
  );
  assert.match(
    studentPageSource,
    /isStudentFieldHidden\(student, "school"\) \?\s*\(\s*<HiddenStudentValue \/>\s*\) :\s*\(\s*<SelectableStudentValue value=\{student\.school \|\| "—"\} \/>\s*\)/,
  );
});

test("StudentProfileTable has responsive mobile card layout and scoped text selection", () => {
  // Selection container
  assert.match(studentPageSource, /useScopedTextSelection\(selectionContainerRef\)/);
  // Mobile cards < xl
  assert.match(
    studentPageSource,
    /<div className="grid gap-3 xl:hidden">[\s\S]*?<StudentProfileCard/,
  );
  // Desktop table xl:
  assert.match(
    studentPageSource,
    /<div[\s\S]*?role="table"[\s\S]*?className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white xl:h-full xl:min-h-0 xl:flex xl:flex-col"/,
  );
});

test("StudentProfileScopeSkeleton matches updated banner and 5-column table structure", () => {
  assert.match(
    studentSkeletonSource,
    /<div className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-\[0_1px_2px_rgba\(15,23,42,0\.04\)\]">/,
  );
  assert.match(
    studentSkeletonSource,
    /export function StudentProfileTableSkeleton\(\)/,
  );
});
