import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const slideSource = readFileSync(
  new URL(
    "../src/components/students/student-reactivation-slide.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("duplicate student conflicts keep the form state and require an explicit decision", () => {
  assert.match(pageSource, /getStudentIdentityConflict\(error\)/);
  assert.match(pageSource, /StudentReactivationSlide/);
  assert.match(pageSource, /duplicate_resolution:/);
  assert.match(slideSource, /Đây là một học viên khác/);
  assert.match(slideSource, /Quay lại chỉnh sửa/);
});

test("reactivation panel is bounded, keyboard-contained, and masks contact data", () => {
  assert.match(slideSource, /max-w-\[500px\]/);
  assert.match(slideSource, /event\.key === "Escape"/);
  assert.match(slideSource, /event\.key !== "Tab"/);
  assert.match(slideSource, /masked_parent_phone/);
  assert.match(slideSource, /masked_student_phone/);
  assert.match(slideSource, /Bắt đầu \$\{formatDate\(previousClass\.enrollment_date\)\}/);
});

test("reactivation loading does not also mark the background student form as saving", () => {
  assert.match(
    pageSource,
    /const isStudentFormSaving =[\s\S]*createMutation\.isPending && pendingIdentityConflict === null[\s\S]*updateMutation\.isPending/,
  );
  assert.match(pageSource, /isSaving=\{isStudentFormSaving\}/);
  assert.doesNotMatch(
    pageSource,
    /const isStudentFormSaving =[\s\S]{0,160}reactivateMutation\.isPending/,
  );
});
