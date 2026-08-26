import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studentPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const studentWorkspaceSource = readFileSync(
  new URL("../src/components/students/student-workspace-dialog.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../src/components/ui/form-dialog-shell.tsx", import.meta.url),
  "utf8",
);

test("student enrollment dates use a non-selectable display control", () => {
  assert.match(
    studentPageSource,
    /const datePickerButtonClassName = `\$\{formTextControlClassName\} select-none text-left`/,
  );
  assert.match(
    studentPageSource,
    /className=\{`\$\{datePickerButtonClassName\} \$\{error \? "border-destructive ring-2 ring-destructive\/15" : ""\}`\}/,
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
    /className="inline-flex h-7 select-text items-center rounded-md border px-2 text-\[13px\] font-semibold"/,
  );
});

test("visible custom fee allows selecting its label and amount as one value", () => {
  assert.match(
    studentPageSource,
    /data-text-selection-scope=\{isHidden \? undefined : "true"\}[\s\S]*data-text-selection-value="true"[\s\S]*Học phí: \{formatCurrencyVnd\(customFee\)\}/,
  );
  assert.match(
    studentPageSource,
    /isHidden[\s\S]*"flex select-none items-center gap-1"[\s\S]*<HiddenStudentValue \/>/,
  );
});

test("removing a student describes the last-class lifecycle and uses precise action labels", () => {
  assert.match(
    studentPageSource,
    /<StudentWorkspaceDialog/,
  );
  assert.doesNotMatch(
    studentPageSource,
    /EntityActionsDialog/,
  );
  assert.match(
    studentWorkspaceSource,
    /label:\s*"Rời lớp"/,
  );
  assert.match(
    studentWorkspaceSource,
    /const isLastActiveClass = student\.active_enrollments\.length <= 1/,
  );
  assert.match(
    studentWorkspaceSource,
    /Đây là lớp đang học cuối cùng nên hồ sơ sẽ chuyển sang danh sách Đã rời lớp\. Lịch sử học phí vẫn được giữ nguyên\./,
  );
  assert.match(
    studentWorkspaceSource,
    /Hồ sơ và các lớp đang học khác vẫn được giữ nguyên\./,
  );
});

test("class form dialog clips its footer to the rounded modal corners", () => {
  assert.match(
    shellSource,
    /className=\{cn\(\s*"flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none[^\"]*sm:rounded-xl"/,
  );
});
