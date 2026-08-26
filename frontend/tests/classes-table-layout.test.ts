import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tableSource = readFileSync(
  new URL("../src/components/classes/classes-table.tsx", import.meta.url),
  "utf8",
);
const scheduleSource = readFileSync(
  new URL("../src/components/classes/class-schedule-list.tsx", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("class table keeps a single five-column layout with no responsive switching", () => {
  assert.match(
    tableSource,
    /const OPERATIONAL_GRID_CLASS =\s*"grid grid-cols-\[minmax\(0,21fr\)_minmax\(0,16fr\)_minmax\(0,17fr\)_minmax\(0,18fr\)_minmax\(0,28fr\)\]"/,
  );
  assert.doesNotMatch(tableSource, /ResizeObserver|useTableLayout|data-table-layout/);
  assert.doesNotMatch(tableSource, /\bcompact\b|\bwide\b/);
  assert.doesNotMatch(tableSource, /classes-info-cell|classes-staff-cell|classes-schedule-cell/);
  assert.doesNotMatch(tableSource, /classes-list-grid|classes-table/);
});

test("no compact/container CSS remains in globals.css", () => {
  assert.doesNotMatch(globalsCss, /container-type|@container|classes-list-grid|classes-table/);
  assert.doesNotMatch(globalsCss, /classes-info-cell|classes-staff-cell|classes-schedule-cell/);
  assert.doesNotMatch(globalsCss, /classes-schedule-tracks|data-table-layout/);
});

test("header is always visible and shares the one grid with rows and skeleton", () => {
  assert.doesNotMatch(tableSource, /classes-list-header/);
  assert.match(tableSource, /<div role="rowgroup" className=\{TABLE_HEADER_CLASS\}>/);
  assert.match(
    tableSource,
    /const OPERATIONAL_GRID_CLASS =[\s\S]*?<div role="row" className=\{`\$\{OPERATIONAL_GRID_CLASS\} table-heading-text/,
  );
  assert.match(
    tableSource,
    /<ClickableRow key=\{class_\.id\} gridClass=\{OPERATIONAL_GRID_CLASS\}/,
  );
  assert.match(tableSource, /className=\{`\$\{gridClass\} cursor-pointer items-start/);
  assert.match(
    tableSource,
    /className=\{`\$\{SPARSE_GRID_CLASS\} items-start`\}>/,
  );
});

test("schedule always renders four flexible tracks on one grid", () => {
  assert.match(
    scheduleSource,
    /grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\] items-start gap-2/,
  );
  assert.doesNotMatch(scheduleSource, /w-\[104px\]/);
  assert.doesNotMatch(scheduleSource, /classes-schedule-tracks/);
  assert.doesNotMatch(scheduleSource, /flex-wrap/);
  assert.match(scheduleSource, /col-span-full inline-flex w-fit/);
});

test("fee column only separates the active collection status", () => {
  assert.match(tableSource, /<FeeMetaLine class_=\{class_\} \/>/);
  assert.doesNotMatch(tableSource, /NextFeeDueLine/);
  assert.doesNotMatch(tableSource, /Kỳ thu tiếp: /);
  assert.doesNotMatch(tableSource, /getClassBillingModeLabel/);
  assert.match(tableSource, /flex min-w-0 flex-wrap items-baseline gap-x-1/);
  assert.match(tableSource, /text: `Đang thu · Hạn \$\{formatDate\(class_\.next_fee_due_date\)\}`/);
  assert.match(tableSource, /text: `· Thu \$\{formatDate\(class_\.next_fee_due_date\)\}`/);
  assert.match(tableSource, /const modeClusters = clusters\.filter\(\(cluster\) => cluster\.key !== "due"\)/);
  assert.match(tableSource, /const separateDueCluster = dueCluster\?\.tone === "amber" \? dueCluster : null/);
  assert.match(tableSource, /const inlineClusters = separateDueCluster/);
  assert.match(tableSource, /mt-0\.5 whitespace-nowrap/);
});

test("schedule cell stretches to the row height and centers vertically", () => {
  assert.match(
    tableSource,
    /<DataCell col="schedule" className="self-stretch pl-3 pr-4 text-gray-700">/,
  );
  assert.match(
    tableSource,
    /<div className="flex h-full min-h-0 flex-col justify-center">[\s\S]*?<ScheduleValue/,
  );
  assert.match(
    tableSource,
    /className="min-w-0 self-stretch pl-3 pr-4 py-2\.5">[\s\S]*?flex h-full min-h-0 flex-col justify-center/,
  );
});

test("scheduled and operational share the weighted grid; only history is equal", () => {
  assert.match(
    tableSource,
    /const SPARSE_GRID_CLASS = "grid grid-cols-\[repeat\(5,minmax\(0,1fr\)\)\]"/,
  );
  assert.doesNotMatch(tableSource, /HISTORICAL_GRID_CLASS/);
  assert.doesNotMatch(
    tableSource,
    /scope === "scheduled" \? SPARSE_GRID_CLASS/,
  );
  assert.match(
    tableSource,
    /<ClickableRow key=\{class_\.id\} gridClass=\{OPERATIONAL_GRID_CLASS\}/,
  );
  assert.match(
    tableSource,
    /<div role="row" className=\{`\$\{OPERATIONAL_GRID_CLASS\} table-heading-text/,
  );
});

test("historical table receives the scope and reuses the sparse grid", () => {
  assert.match(tableSource, /Pick<ClassesTableProps, "classes" \| "onRowClick" \| "scope">/);
  assert.match(
    tableSource,
    /<HistoricalClassesTable\s+classes=\{classes\}\s+onRowClick=\{onRowClick\}\s+scope=\{scope\}\s*\/>/,
  );
  assert.match(tableSource, /const isCancelledScope = scope === "cancelled"/);
  assert.match(tableSource, /const lastColumnLabel = isCancelledScope \? "Ngày huỷ" : "Kết thúc"/);
  assert.match(tableSource, /label: lastColumnLabel/);
});

test("historical rows never repeat the end date and show the start date once", () => {
  assert.equal(
    (tableSource.match(/\–\{formatDate\(class_\.end_date\)\}/g) ?? []).length,
    1,
  );
  assert.match(tableSource, /Bắt đầu: \{formatDate\(class_\.start_date\)\}/);
  assert.match(tableSource, /class_\.cancelled_at \?\? class_\.end_date/);
  assert.match(tableSource, /getClassGradeYearLabel\(class_\)/);
  assert.doesNotMatch(
    tableSource,
    /gradeYearLabel[\s\S]{0,80}\{class_\.student_count\} học viên/,
  );
});

test("historical short columns center both axes", () => {
  assert.match(
    tableSource,
    /<DataCell col="headcount" className="self-stretch px-3 text-gray-700">[\s\S]*?items-center justify-center text-center/,
  );
  assert.match(
    tableSource,
    /<DataCell col="end" className="self-stretch pl-3 pr-4 text-gray-600">[\s\S]*?items-center justify-center text-center/,
  );
  assert.match(
    tableSource,
    /align=\{column\.key === "headcount" \|\| column\.key === "end" \? "center" : "left"\}/,
  );
});

test("historical skeleton exists and uses the sparse grid", () => {
  assert.match(tableSource, /export function HistoricalClassesSkeleton\(\)/);
  assert.match(
    tableSource,
    /HistoricalClassesSkeleton[\s\S]*?className=\{`\$\{SPARSE_GRID_CLASS\} px-3 py-3`\}/,
  );
});

test("operational skeleton uses the weighted grid like the real table", () => {
  assert.match(tableSource, /export function ClassesSkeleton\(\)/);
  assert.match(
    tableSource,
    /ClassesSkeleton[\s\S]*?className=\{`\$\{OPERATIONAL_GRID_CLASS\} px-3 py-3`\}/,
  );
  assert.match(
    tableSource,
    /className=\{`\$\{OPERATIONAL_GRID_CLASS\} items-start`\}>/,
  );
});
