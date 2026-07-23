import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const classFormSource = readFileSync(
  new URL("../src/components/classes/class-form-dialog.tsx", import.meta.url),
  "utf8",
);
const staffFormSource = readFileSync(
  new URL("../src/components/staff/staff-form-dialog.tsx", import.meta.url),
  "utf8",
);
const studentPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);

test("persisted management forms share the edit-blur-submit feedback lifecycle", () => {
  for (const source of [classFormSource, staffFormSource, studentPageSource]) {
    assert.match(source, /useFormFieldFeedback/);
    assert.match(source, /mode: "onChange"/);
    assert.match(source, /markSubmitted\(\)/);
    assert.match(source, /shouldShowError\(/);
  }
});

test("management notices compare normalized persisted values rather than raw dirty flags", () => {
  assert.match(classFormSource, /normalizedClassFormKey/);
  assert.match(staffFormSource, /normalizedStaffKey/);
  assert.match(studentPageSource, /normalizedStudentFormKey/);
  assert.doesNotMatch(classFormSource, /formState: \{ errors, isDirty/);
  assert.doesNotMatch(staffFormSource, /formState: \{ errors, isDirty/);
  assert.doesNotMatch(studentPageSource, /formState: \{ errors, isDirty/);
});

test("student birth date and paired contacts validate only after leaving their controls", () => {
  assert.match(studentPageSource, /onBlur=\{\(\) => markBlur\("birth_date"\)\}/);
  assert.match(studentPageSource, /markBlur\("student_contact"\)/);
  assert.match(studentPageSource, /markBlur\("parent_contact"\)/);
  assert.match(studentPageSource, /shouldValidate: true/);
});

test("money drafts keep incomplete notation in the same blur-validation lifecycle", () => {
  assert.match(classFormSource, /onDraftChange=\{\(rawValue\) => markInput\("base_fee", rawValue\)\}/);
  assert.match(studentPageSource, /if \(rawValue && !isComplete\)/);
  assert.match(
    studentPageSource,
    /setEnrollmentFeeDraftError\(validationMessages\.feeFormat\);[\s\S]*setError\("custom_fee"/,
  );
  assert.match(
    studentPageSource,
    /if \(enrollmentFeeDraftError\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*markBlur\("custom_fee"\)/,
  );
});

test("new classes require a configured schedule without displaying required stars", () => {
  assert.match(classFormSource, /scheduleRequiredError/);
  assert.match(classFormSource, /markInput\("schedule"/);
  assert.doesNotMatch(classFormSource, /aria-hidden="true">\*<\/span>/);
});

test("new students require profile and parent data but keep class-fee inheritance optional", () => {
  assert.match(studentPageSource, /const studentCreateSchema/);
  assert.match(studentPageSource, /validationMessages\.required\("ngày sinh"\)/);
  assert.match(studentPageSource, /validationMessages\.required\("trường"\)/);
  assert.match(studentPageSource, /validationMessages\.required\("tên Zalo phụ huynh"\)/);
  assert.match(studentPageSource, /validationMessages\.required\("số điện thoại phụ huynh"\)/);
  assert.match(studentPageSource, /validationMessages\.required\("ngày bắt đầu"\)/);
  assert.match(studentPageSource, /means "use the selected class fee", not missing data/);
  assert.doesNotMatch(studentPageSource, /aria-hidden="true">\*<\/span>/);
});

test("a new student's start date participates in the persisted-value comparison", () => {
  assert.match(studentPageSource, /initialCreateFormKeyRef/);
  assert.match(studentPageSource, /normalizedStudentCreateFormKey/);
  assert.match(
    studentPageSource,
    /enrollment_date: values\.enrollment_date \|\| null/,
  );
  assert.match(
    studentPageSource,
    /normalizedStudentCreateFormKey\(watchedStudentValues\) !== initialCreateFormKeyRef\.current/,
  );
  assert.match(studentPageSource, /markInput\("enrollment_date", dateStr\)/);
});
