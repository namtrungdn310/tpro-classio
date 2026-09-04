import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceDialogSource = readFileSync(
  resolve(process.cwd(), "src/components/students/student-workspace-dialog.tsx"),
  "utf8",
);
const studentsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);
const apiStudentsSource = readFileSync(
  resolve(process.cwd(), "src/lib/api/students.ts"),
  "utf8",
);

test("StudentWorkspaceDialog uses 'Học lại' wording and headers", () => {
  // Header
  assert.match(
    workspaceDialogSource,
    /restore:\s*"Học lại tại trung tâm"/,
  );
  // Desktop rail
  assert.match(
    workspaceDialogSource,
    /label:\s*isArchived\s*\?\s*"Học lại"\s*:\s*"Ngừng học"/,
  );
  // Mobile rail
  assert.match(
    workspaceDialogSource,
    /danger:\s*!isArchived/,
  );
});

test("StudentLifecyclePanel has required 'Học lại' wording and summary rows", () => {
  // Heading
  assert.match(
    workspaceDialogSource,
    /\{restoring\s*\?\s*"Sau khi học lại"\s*:\s*"Sau khi xác nhận"\}/,
  );
  // Summary status
  assert.match(
    workspaceDialogSource,
    /Chuyển sang Học viên chưa xếp lớp/,
  );
  // Summary class
  assert.match(
    workspaceDialogSource,
    /Không tự quay lại lớp cũ/,
  );
  // Summary data
  assert.match(
    workspaceDialogSource,
    /Giữ nguyên mã học viên, học phí và lịch sử học tập/,
  );
  // Textarea label
  assert.match(
    workspaceDialogSource,
    /\{restoring\s*\?\s*"Lý do học lại"\s*:\s*"Lý do"\}/,
  );
  // Placeholder
  assert.match(
    workspaceDialogSource,
    /placeholder=\{restoring\s*\?\s*"Ví dụ: Học viên đăng ký học lại"\s*:\s*"Ví dụ: Chuyển trường"\}/,
  );
  // CTA
  assert.match(
    workspaceDialogSource,
    /\{restoring\s*\?\s*"Xác nhận học lại"\s*:\s*"Ngừng học"\}/,
  );
  // Pending label
  assert.match(
    workspaceDialogSource,
    /pendingLabel=\{restoring\s*\?\s*"Đang cập nhật"\s*:\s*"Đang xử lý"\}/,
  );
});

test("StudentLifecyclePanel enforces accessible validation and non-destructive primary button", () => {
  // Role alert and aria-describedby for inline validation
  assert.match(
    workspaceDialogSource,
    /role="alert"/,
  );
  assert.match(
    workspaceDialogSource,
    /id="student-lifecycle-reason-error"/,
  );
  assert.match(
    workspaceDialogSource,
    /aria-describedby=\{errorMessage\s*\?\s*"student-lifecycle-reason-error"\s*:\s*undefined\}/,
  );
  assert.match(
    workspaceDialogSource,
    /aria-invalid=\{Boolean\(errorMessage\)\}/,
  );
  // Min 3 characters validation
  assert.match(
    workspaceDialogSource,
    /normalizedReason\.length\s*<\s*3/,
  );
  // Max 500 characters validation
  assert.match(
    workspaceDialogSource,
    /normalizedReason\.length\s*>\s*500/,
  );
  // Primary button style when restoring (not red)
  assert.match(
    workspaceDialogSource,
    /restoring\s*\?\s*"bg-primary text-white hover:bg-primary-hover"\s*:\s*"bg-red-600 text-white hover:bg-red-700"/,
  );
});

test("restoreStudent API and payload sends reason and expected_updated_at", () => {
  assert.match(
    apiStudentsSource,
    /export async function restoreStudent\(\s*id:\s*string,\s*reason:\s*string,\s*expected_updated_at:\s*string,\s*\)/,
  );
  assert.match(
    apiStudentsSource,
    /apiClient\.post<unknown>\(`\/students\/\$\{id\}\/restore`,\s*\{\s*reason,\s*expected_updated_at,\s*\}\)/,
  );
  assert.match(
    studentsPageSource,
    /expected_updated_at:\s*expected_updated_at\s*\|\|\s*workspaceStudent\.updated_at/,
  );
});

test("restoreMutation optimistically updates caches and handles errors and timeout", () => {
  // Set detail cache immediately
  assert.match(
    studentsPageSource,
    /queryClient\.setQueryData\(studentQueryKeys\.detail\(student\.id\),\s*student\)/,
  );
  // Immediate removal from stopped list cache
  assert.match(
    studentsPageSource,
    /items:\s*page\.items\.filter\(\(item\)\s*=>\s*item\.id\s*!==\s*student\.id\)/,
  );
  // Immediate update of summary counts: stopped - 1, unassigned + 1
  assert.match(
    studentsPageSource,
    /stopped:\s*Math\.max\(0,\s*old\.stopped\s*-\s*1\),\s*unassigned:\s*old\.unassigned\s*\+\s*1/,
  );
  // Success toast
  assert.match(
    studentsPageSource,
    /notify\.success\(`Đã chuyển \$\{student\.full_name\} sang Học viên chưa xếp lớp\.`\)/,
  );
  // Timeout fallback recovery with getStudent
  assert.match(
    studentsPageSource,
    /freshStudent\.status\s*===\s*"active"\s*&&\s*freshStudent\.list_state\s*===\s*"UNASSIGNED"/,
  );
  // Structured error handling for STUDENT_CHANGED, STUDENT_NOT_STOPPED, STUDENT_RESTORE_MEMBERSHIP_CONFLICT
  assert.match(studentsPageSource, /code\s*===\s*"STUDENT_CHANGED"/);
  assert.match(studentsPageSource, /code\s*===\s*"STUDENT_NOT_STOPPED"/);
  assert.match(studentsPageSource, /code\s*===\s*"STUDENT_RESTORE_MEMBERSHIP_CONFLICT"/);
});

test("No remaining 'Tiếp nhận lại' in restore flow", () => {
  assert.doesNotMatch(workspaceDialogSource, /"Tiếp nhận lại"/);
  assert.doesNotMatch(studentsPageSource, /"Tiếp nhận lại"/);
});
