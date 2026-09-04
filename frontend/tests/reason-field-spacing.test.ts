import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const studentWorkspace = source(
  "../src/components/students/student-workspace-dialog.tsx",
);
const feeRefundDialog = source(
  "../src/components/fees/fee-refund-dialog.tsx",
);
const staffPayrollDialog = source(
  "../src/components/staff/staff-payroll-dialog.tsx",
);
const classMakeupWorkspace = source(
  "../src/components/classes/class-makeup-workspace.tsx",
);
const classFormDialog = source(
  "../src/components/classes/class-form-dialog.tsx",
);

test("reason inputs use the shared six-pixel label-to-control spacing", () => {
  assert.match(
    studentWorkspace,
    /id="student-lifecycle-reason"[\s\S]*?className="mt-1\.5 block/,
  );
  assert.match(
    feeRefundDialog,
    /Lý do hoàn phí[\s\S]*?"mt-1\.5 block h-16/,
  );
  assert.match(
    feeRefundDialog,
    /Lý do hoàn tác khoản hoàn[\s\S]*?"mt-1\.5"/,
  );
  assert.equal(
    staffPayrollDialog.match(/form-label-text mb-1\.5 block text-gray-700">Lý do/g)
      ?.length,
    2,
  );
  assert.match(
    classMakeupWorkspace,
    /Lý do hoãn[\s\S]*?"mt-1\.5 w-full"/,
  );
  assert.match(
    classMakeupWorkspace,
    /value=\{reasonNote\}[\s\S]*?"mt-1\.5 block h-16/,
  );
  assert.match(
    classFormDialog,
    /controlId="class-start-date-reason"[\s\S]*?label="Lý do đổi ngày bắt đầu"/,
  );
});
