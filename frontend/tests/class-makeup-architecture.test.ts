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
const studentPageSource = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const statusPillSource = readFileSync(
  new URL("../src/components/ui/status-pill.tsx", import.meta.url),
  "utf8",
);

test("postpone workspace does not expose make-up scheduling controls", () => {
  assert.doesNotMatch(workspaceSource, /scheduleTarget|schedulePreviewQuery|formatDateTime/);
  assert.doesNotMatch(workspaceSource, /Xếp lịch bù|Bỏ xếp lịch|Khôi phục buổi gốc/);
  assert.match(workspaceSource, /createClassSuspension/);
});

test("make-up workspace never offers a substitute staff selector", () => {
  assert.doesNotMatch(workspaceSource, /teacher-options|staff-options|substitute/i);
  assert.doesNotMatch(workspaceSource, /getActiveTeacherOptions/);
});

test("postpone workspace keeps the intended notes and aligned controls", () => {
  assert.match(workspaceSource, /aria-label="Hoãn buổi học"/);
  assert.match(workspaceSource, /Ngày thu sẽ dời theo số ngày hoãn thực tế của/);
  assert.match(workspaceSource, /Chọn khoảng ngày để xem các buổi học trong phạm vi thời gian lớp có thể hoãn/);
  assert.doesNotMatch(workspaceSource, /Tổng .*buổi chưa hoàn tất/);
  assert.doesNotMatch(workspaceSource, />Hoãn buổi học<\/h3>/);
  assert.doesNotMatch(workspaceSource, /không ảnh hưởng tài chính/);
  assert.doesNotMatch(workspaceSource, /Giáo viên\/trợ giảng buổi bù được kế thừa từ buổi gốc/);
  assert.doesNotMatch(workspaceSource, /scheduleNow|schedule_now/);
  assert.doesNotMatch(workspaceSource, /Xếp bù ngay|Xếp sau/);
  assert.match(workspaceSource, />Ghi chú<\/span>/);
  assert.doesNotMatch(workspaceSource, /Ghi chú \(tùy chọn\)/);
  assert.match(workspaceSource, /formTextControlClassName/);
  assert.equal((workspaceSource.match(/<ManualDateInput/g) ?? []).length, 2);
  assert.doesNotMatch(workspaceSource, /DatePickerSlide|datePickerTarget/);
  assert.match(workspaceSource, /<Button/);
  assert.doesNotMatch(workspaceSource, /hoàn tiền|refund/i);
});

test("postpone reason and note use full-width controls matching the student note field", () => {
  assert.match(workspaceSource, /className="mt-3 grid gap-3"/);
  assert.match(workspaceSource, /<select[\s\S]*?"mt-1\.5 w-full"/);
  assert.match(workspaceSource, /<textarea[\s\S]*?rows=\{2\}[\s\S]*?h-16 min-h-16 w-full resize-none py-2 leading-5/);
});

test("postpone preview uses per-enrollment credit semantics", () => {
  assert.match(workspaceSource, /member_summary/);
  assert.match(workspaceSource, /Ngày thu sẽ dời theo số ngày hoãn thực tế/);
  assert.match(workspaceSource, /suspensionPreviewQuery/);
  assert.doesNotMatch(workspaceSource, /schedule_now|billing_impact/);
});

test("class table never renders FINALIZING and labels postponed sessions without a make-up action", () => {
  assert.doesNotMatch(tableSource, /FINALIZING/);
  assert.match(tableSource, /STOPPED: \{ label: "Đã ngừng"/);
  assert.match(tableSource, /MakeupPendingBadge/);
  assert.match(tableSource, /buổi đã hoãn/);
  assert.match(tableSource, /onPostponedClick/);
  assert.match(tableSource, /Xem chi tiết/);
});

test("history slide contains the class adjustment timeline", () => {
  assert.match(historySource, /Điều chỉnh buổi học/);
  assert.match(historySource, /data\.adjustments/);
  assert.match(historySource, /Buổi học:/);
  assert.match(historySource, /formatSessionRange\(adjustment\.original_start_at, adjustment\.original_end_at\)/);
  assert.ok(
    historySource.indexOf('title="Điều chỉnh buổi học"') <
      historySource.indexOf('title="Lịch học và giáo viên theo buổi"'),
  );
});

test("upcoming enrollment and postponed-session badges share one status primitive", () => {
  assert.match(
    studentPageSource,
    /<StatusPill className="text-xs font-semibold" title="Ngày bắt đầu trong tương lai">/,
  );
  assert.match(tableSource, /<StatusPill/);
  assert.match(statusPillSource, /rounded-full border/);
  assert.match(statusPillSource, /aria-label=\{title\}/);
  assert.match(statusPillSource, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("dashboard board marks postponed and make-up occurrences", () => {
  assert.match(boardSource, /Hoãn/);
  assert.match(boardSource, /Học bù/);
  assert.match(boardSource, /buildMakeupMarkers/);
});

test("classes page wires suspension mode without legacy scheduling mutation", () => {
  assert.doesNotMatch(pageSource, /makeupMutation|onMakeupAction/);
  assert.match(pageSource, /onPostponed/);
  assert.match(pageSource, /onPostponedClick=\{openClassHistory\}/);
});
