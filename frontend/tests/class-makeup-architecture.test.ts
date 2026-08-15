import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync(
  new URL("../src/components/classes/class-makeup-workspace.tsx", import.meta.url),
  "utf8",
);
const tableSource = readFileSync(
  new URL("../src/components/classes/classes-table.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../src/components/classes/class-history-slide.tsx", import.meta.url),
  "utf8",
);
const boardSource = readFileSync(
  new URL("../src/components/layout/weekly-schedule-board.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/classes/page.tsx", import.meta.url),
  "utf8",
);

test("make-up workspace shows original time, read-only duration/staff and eligible count", () => {
  assert.match(workspaceSource, /formatDateTime\(scheduleTarget\.original_start_at\)/);
  assert.match(workspaceSource, /cố định bằng buổi gốc/);
  assert.match(workspaceSource, /scheduleTarget\.staff/);
  assert.match(workspaceSource, /scheduleTarget\.eligible_student_count/);
});

test("make-up workspace never offers a substitute staff selector", () => {
  assert.doesNotMatch(workspaceSource, /teacher-options|staff-options|substitute/i);
  assert.doesNotMatch(workspaceSource, /getActiveTeacherOptions/);
});

test("make-up workspace explains billing impact is none", () => {
  assert.match(workspaceSource, /không ảnh hưởng tài chính/);
  assert.match(workspaceSource, /học phí, kỳ thu và lịch tuần\s*giữ nguyên/);
  assert.doesNotMatch(workspaceSource, /hoàn tiền|refund/i);
});

test("make-up conflicts appear inline and block save", () => {
  assert.match(workspaceSource, /Đang kiểm tra xung đột/);
  assert.match(workspaceSource, /conflicts\[0\]\.message/);
  assert.match(workspaceSource, /disabled=\{isSaving \|\| conflicts\.length > 0/);
});

test("make-up groups pending, scheduled, awaiting-confirmation and completed distinctly", () => {
  assert.match(workspaceSource, /Chờ xếp lịch bù/);
  assert.match(workspaceSource, /Đã xếp lịch bù/);
  assert.match(workspaceSource, /Chờ xác nhận/);
  assert.match(workspaceSource, /Đã học bù/);
  assert.match(workspaceSource, /AWAITING_CONFIRMATION/);
});

test("postpone flow supports schedule-now and schedule-later", () => {
  assert.match(workspaceSource, /Xếp bù ngay/);
  assert.match(workspaceSource, /Xếp sau/);
});

test("class table never renders FINALIZING and keeps the pending make-up badge", () => {
  assert.doesNotMatch(tableSource, /FINALIZING/);
  assert.match(tableSource, /COMPLETED: \{ label: "Đã kết thúc"/);
  assert.match(tableSource, /MakeupPendingBadge/);
  assert.match(tableSource, /buổi chờ bù/);
});

test("history slide contains the class adjustment timeline", () => {
  assert.match(historySource, /Điều chỉnh buổi học/);
  assert.match(historySource, /data\.adjustments/);
});

test("dashboard board marks postponed and make-up occurrences", () => {
  assert.match(boardSource, /Hoãn/);
  assert.match(boardSource, /Học bù/);
  assert.match(boardSource, /buildMakeupMarkers/);
});

test("classes page wires make-up actions to the workspace", () => {
  assert.match(pageSource, /makeupMutation/);
  assert.match(pageSource, /"postpone" \| "schedule" \| "unschedule" \| "complete" \| "restore"/);
  assert.match(pageSource, /onMakeupAction/);
});
