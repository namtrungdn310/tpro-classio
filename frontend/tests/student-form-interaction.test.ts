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
const classSelectionSource = readFileSync(
  new URL("../src/components/students/class-selection-view.tsx", import.meta.url),
  "utf8",
);

test("class cards reserve a full-width line for the complete academic year", () => {
  assert.match(
    classSelectionSource,
    /mt-0\.5 whitespace-nowrap text-xs font-medium leading-4 tracking-\[-0\.01em\] text-gray-500/,
  );
  assert.doesNotMatch(
    classSelectionSource,
    /mt-0\.5 truncate text-xs font-medium text-gray-500/,
  );
});

test("student enrollment dates use the same manual date control as birth date", () => {
  assert.match(
    studentPageSource,
    /<ManualDateInput[\s\S]*?id="student-birth-date"/,
  );
  assert.match(
    studentPageSource,
    /<ManualDateInput[\s\S]*?id="initial-enrollment-date"/,
  );
  assert.match(
    studentPageSource,
    /id=\{`enrollment-date-\$\{enrollment\.id\}`\}/,
  );
  assert.doesNotMatch(studentPageSource, /DatePickerSlide|datePickerTarget|datePickerButtonClassName/);
});

test("clearing an existing enrollment date never restores the persisted date", () => {
  assert.match(
    studentPageSource,
    /const enrollmentDraft = enrollmentFees\[enrollment\.id\];[\s\S]*enrollmentDraft[\s\S]*\? enrollmentDraft\.enrollment_date[\s\S]*: enrollment\.enrollment_date/,
  );
  assert.doesNotMatch(
    studentPageSource,
    /enrollmentFees\[enrollment\.id\]\?\.enrollment_date \?\? enrollment\.enrollment_date/,
  );
});

test("an empty enrollment-date draft is neither dirty nor red before blur", () => {
  assert.match(
    studentPageSource,
    /comparableManualDate\(draft\.enrollment_date, enrollment\.enrollment_date\)/,
  );
  assert.match(
    studentPageSource,
    /isSubmitted \|\| blurredEnrollmentDateIds\.has\(enrollmentId\)/,
  );
  assert.match(studentPageSource, /onEnrollmentDateBlur/);
});

test("new student session selection participates in the unsaved-change comparison", () => {
  assert.match(studentPageSource, /initialSelectedSlotIdsRef/);
  assert.match(studentPageSource, /normalizedSlotIdsKey\(selectedSlotIds\)/);
  assert.match(
    studentPageSource,
    /normalizedSlotIdsKey\(initialSelectedSlotIdsRef\.current\)/,
  );
  assert.match(studentPageSource, /onChange=\{setSelectedSlotIds\}/);
});

test("an unassigned profile has a dedicated first-class assignment flow", () => {
  assert.match(
    studentPageSource,
    /const isUnassignedStudent = Boolean\(student && activeEnrollments\.length === 0\)/,
  );
  assert.match(
    studentPageSource,
    /const useFullWidthProfileName = isStandaloneProfileCreate \|\| isUnassignedStudent/,
  );
  assert.match(
    studentPageSource,
    /className=\{useFullWidthProfileName \? "sm:col-span-2" : undefined\}/,
  );
  assert.match(studentPageSource, /isInitialAssignment \? "Xếp lớp" : "Chuyển \/ thêm lớp"/);
  assert.match(studentPageSource, /isInitialAssignment \? "Xếp lớp" : "Thiết lập"/);
  assert.match(studentPageSource, /\{!isInitialAssignment \? \([\s\S]*?role="tablist"/);
  assert.doesNotMatch(studentPageSource, /isInitialAssignment \? "Chưa xếp lớp\."/);
  assert.match(studentPageSource, /isInitialAssignment \? "Đã chọn xếp lớp"/);
  assert.match(studentPageSource, /<p className="text-base font-semibold text-gray-900">Thao tác<\/p>/);
  assert.match(studentPageSource, /<p className="section-title-text text-gray-900">Danh sách lớp<\/p>/);
  assert.doesNotMatch(studentPageSource, /isInitialAssignment \? "Thiết lập lớp"/);
  assert.doesNotMatch(studentPageSource, /isInitialAssignment \? "Chọn lớp" : "Danh sách lớp"/);
});

test("transfer and initial assignment class cards stay readable at two per row", () => {
  assert.match(
    studentPageSource,
    /<p className="section-title-text text-gray-900">Danh sách lớp<\/p>[\s\S]*className="grid gap-3 sm:grid-cols-2"/,
  );
  assert.doesNotMatch(
    studentPageSource,
    /<p className="section-title-text text-gray-900">Danh sách lớp<\/p>[\s\S]*sm:grid-cols-2 xl:grid-cols-3/,
  );
});

test("selected-class configuration remains scrollable without growing beyond the slide", () => {
  assert.match(
    studentPageSource,
    /flex min-h-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/,
  );
  assert.match(
    studentPageSource,
    /scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-gray-50 p-4/,
  );
});

test("selected classes are indicated once in the class list without a duplicate summary", () => {
  assert.doesNotMatch(studentPageSource, />Lớp đã chọn<\/p>/);
  assert.doesNotMatch(studentPageSource, /function SelectedClassChip/);
  assert.doesNotMatch(studentPageSource, /Chưa chọn lớp nào\./);
  assert.match(
    studentPageSource,
    /aria-pressed=\{selected\}[\s\S]*selected \? onRemoveClass\(class_\.id\) : onAddClass\(class_\.id\)/,
  );
});

test("session selection keeps the final selected lesson without an extra warning row", () => {
  assert.match(
    studentPageSource,
    /const isLastSelected = checked && selectedSlotIds.length === 1/,
  );
  assert.match(studentPageSource, /disabled=\{isLastSelected\}/);
  assert.doesNotMatch(studentPageSource, /onChange\(allSelected \? \[\] : availableIds\)/);
  assert.doesNotMatch(studentPageSource, /Vui lòng chọn ít nhất một buổi học\.<\/p>/);
});

test("session cards keep four readable equal columns across every selected class", () => {
  assert.match(
    studentPageSource,
    /sm:w-\[82vw\] lg:w-\[76vw\] xl:w-\[72vw\] 2xl:w-\[68vw\]/,
  );
  assert.match(studentPageSource, /xl:grid-cols-\[(?:400px|420px|430px|440px|460px|560px)_minmax\(0,(?:1fr|520px)\)\]/);
  assert.match(
    studentPageSource,
    /grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\] gap-2/,
  );
  assert.match(
    studentPageSource,
    /whitespace-nowrap text-xs font-normal leading-3\.5 tabular-nums tracking-\[-0\.01em\]/,
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

test("custom fee remains visible and allows selecting its label and amount as one value", () => {
  assert.match(
    studentPageSource,
    /data-text-selection-scope="true"[\s\S]*data-text-selection-value="true"[\s\S]*Học phí: \{formatCurrencyVnd\(customFee\)\}/,
  );
  assert.doesNotMatch(
    studentPageSource,
    /renderPrivacyToggle\("(?:custom_fee|enrollment_date)"/,
  );
});

test("privacy icons are limited to the five approved student fields", () => {
  const toggles = [...studentPageSource.matchAll(/renderPrivacyToggle\("([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(toggles, [
    "birth_date",
    "notes",
    "parent_contact",
    "school",
    "student_contact",
  ]);
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
    /Chuyển sang Học viên chưa xếp lớp/,
  );
  assert.match(
    studentWorkspaceSource,
    /Tiếp tục học \$\{student\.active_enrollments\.length - 1\} lớp khác/,
  );
  assert.match(
    studentWorkspaceSource,
    /Học phí và lịch sử học tập được giữ nguyên/,
  );
  assert.doesNotMatch(
    studentWorkspaceSource,
    /Lớp hiện tại:/,
    "the dialog header already identifies the selected class",
  );
});

test("class form dialog clips its footer to the rounded modal corners", () => {
  assert.match(
    shellSource,
    /className=\{cn\(\s*"flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none[^\"]*sm:rounded-xl"/,
  );
});
