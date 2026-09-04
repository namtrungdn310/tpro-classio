import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findHorizontalNavigationTarget,
  findVerticalNavigationTarget,
  isHorizontalNavigationBoundary,
} from "../src/lib/forms/field-navigation";

const classDialogSource = source(
  "../src/components/classes/class-form-dialog.tsx",
);
const shellSource = source("../src/components/ui/form-dialog-shell.tsx");
const staffDialogSource = source(
  "../src/components/staff/staff-form-dialog.tsx",
);
const refundDialogSource = source(
  "../src/components/fees/fee-refund-dialog.tsx",
);
const studentPageSource = source(
  "../src/app/(dashboard)/students/page.tsx",
);
const fieldNavigationSource = source("../src/lib/forms/field-navigation.ts");

test("vertical field navigation preserves a column when the next row has it", () => {
  const fields = [
    { row: 0, column: 0 },
    { row: 0, column: 1 },
    { row: 1, column: 0 },
    { row: 1, column: 1 },
  ];

  assert.deepEqual(
    findVerticalNavigationTarget(fields, { row: 0, column: 1 }, 1),
    { row: 1, column: 1 },
  );
  assert.deepEqual(
    findVerticalNavigationTarget(fields, { row: 1, column: 0 }, -1),
    { row: 0, column: 0 },
  );
});

test("vertical field navigation falls back to the nearest available column", () => {
  const fields = [
    { row: 0, column: 0 },
    { row: 1, column: 0 },
    { row: 1, column: 2 },
    { row: 2, column: 1 },
  ];

  assert.deepEqual(
    findVerticalNavigationTarget(fields, { row: 0, column: 0 }, 1),
    { row: 1, column: 0 },
  );
  assert.deepEqual(
    findVerticalNavigationTarget(fields, { row: 2, column: 1 }, -1),
    { row: 1, column: 0 },
  );
});

test("vertical field navigation leaves focus unchanged at form boundaries", () => {
  const fields = [
    { row: 0, column: 0 },
    { row: 1, column: 0 },
  ];

  assert.equal(
    findVerticalNavigationTarget(fields, { row: 0, column: 0 }, -1),
    null,
  );
  assert.equal(
    findVerticalNavigationTarget(fields, { row: 1, column: 0 }, 1),
    null,
  );
});

test("horizontal field navigation moves only to the adjacent field in the same row", () => {
  const fields = [
    { row: 0, column: 0 },
    { row: 1, column: 0 },
    { row: 1, column: 1 },
    { row: 1, column: 3 },
  ];

  assert.deepEqual(
    findHorizontalNavigationTarget(fields, { row: 1, column: 0 }, 1),
    { row: 1, column: 1 },
  );
  assert.deepEqual(
    findHorizontalNavigationTarget(fields, { row: 1, column: 3 }, -1),
    { row: 1, column: 1 },
  );
  assert.equal(
    findHorizontalNavigationTarget(fields, { row: 0, column: 0 }, 1),
    null,
  );
});

test("horizontal navigation changes fields only at a collapsed caret boundary", () => {
  assert.equal(isHorizontalNavigationBoundary(8, 8, 8, 1), true);
  assert.equal(isHorizontalNavigationBoundary(8, 0, 0, -1), true);
  assert.equal(isHorizontalNavigationBoundary(8, 4, 4, 1), false);
  assert.equal(isHorizontalNavigationBoundary(8, 0, 3, -1), false);
  assert.equal(isHorizontalNavigationBoundary(8, null, null, 1), false);
});

test("form arrow navigation preserves browser-native text editing", () => {
  assert.match(
    fieldNavigationSource,
    /supportsFormArrowNavigation\(current\)/,
  );
  assert.match(shellSource, /useModalDialog\(\{/);
  assert.doesNotMatch(classDialogSource, /data-dialog-autofocus/);
  assert.match(
    classDialogSource,
    /const isArrowKey =[\s\S]*?"ArrowUp"[\s\S]*?isNativeTextEditingTarget\(target\)[\s\S]*?if \(isArrowKey && !event\.defaultPrevented && !hasActiveCaret\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.currentTarget\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(shellSource, /shadow-xl outline-none/);
});

test("student, class, staff and refund forms share one arrow navigation helper", () => {
  for (const formSource of [
    studentPageSource,
    classDialogSource,
    staffDialogSource,
    refundDialogSource,
  ]) {
    assert.match(formSource, /moveFocusByFormArrow/);
  }

  assert.match(classDialogSource, /data-row=\{0\}/);
  assert.match(classDialogSource, /dataRow=\{5\}/);
  assert.match(
    classDialogSource,
    /id="class-duration-weeks"[\s\S]*?data-row=\{6\}[\s\S]*?data-col=\{0\}/,
  );
  assert.doesNotMatch(classDialogSource, /id="class-end-date"/);
  assert.match(staffDialogSource, /data-row=\{1\}/);
  assert.match(refundDialogSource, /dataRow=\{index\}/);
  assert.match(
    refundDialogSource,
    /data-row=\{refundableRecords\.length\}/,
  );
});

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
