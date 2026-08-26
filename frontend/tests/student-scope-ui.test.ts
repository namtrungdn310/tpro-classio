import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studentPage = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);

test("student scopes use concise labels and one unassigned-profile action", () => {
  assert.match(studentPage, /label: "Học viên đang học"/);
  assert.match(studentPage, /label: "Học viên chưa xếp lớp"/);
  assert.match(studentPage, /label: "Học viên ngừng học trung tâm"/);
  assert.doesNotMatch(studentPage, /QuickActionFab label=\{view === "unassigned"/);

  const headerActions = studentPage.match(
    /<AddStudentButton label="Thêm hồ sơ"/g,
  );
  assert.equal(headerActions?.length, 1);
});

test("the enrollment transfer overlay escapes the inert student workspace", () => {
  const transferSlide = studentPage.match(
    /function EnrollmentTransferSlide[\s\S]*?function SelectedClassChip/,
  )?.[0];

  assert.ok(transferSlide, "EnrollmentTransferSlide source should exist");
  assert.match(transferSlide, /return createPortal\(/);
  assert.match(transferSlide, /document\.body/);
});

test("student create, edit, transfer and continuation share explicit session pricing", () => {
  assert.match(studentPage, /function SessionSelector/);
  assert.match(studentPage, /getEnrollmentFeeSuggestion/);
  assert.match(studentPage, /Gợi ý học phí/);
  assert.match(studentPage, /selected_slot_ids: enrollmentActionPlan\.targetConfigs/);
  assert.match(studentPage, /Mỗi lớp cần chọn ít nhất một buổi học/);
});

test("editing an enrollment persists selected sessions with profile changes", () => {
  assert.match(studentPage, /payload\.selected_slot_ids = billingValues\.selected_slot_ids/);
  assert.match(studentPage, /selected_slot_ids: enrollment\.selected_slot_ids/);
  assert.match(studentPage, /onEnrollmentSlotsChange/);
  assert.match(studentPage, /sortedEnrollments\.map\(\(enrollment\) =>/);
  assert.match(studentPage, /Vui lòng chọn ít nhất một buổi học trước khi lưu/);
  assert.match(studentPage, /if \(sessionSelectionError\) \{/);
});
