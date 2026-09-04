import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historySource = readFileSync(
  new URL("../src/components/classes/class-history-slide.tsx", import.meta.url),
  "utf8",
);

test("class history uses the shared staff and student icon family", () => {
  assert.match(historySource, /RiIdCardLine as Staff/);
  assert.match(historySource, /RiTeamLine as Students/);
  assert.match(historySource, /title="Nhân sự phụ trách"/);
  assert.match(historySource, /staffTypeLabel\(event\.staff_type\)/);
});

test("class history student search uses the full shared text control", () => {
  assert.match(historySource, /formTextControlClassName/);
  assert.match(historySource, /placeholder=\{tab === "active" \? "Tìm học viên đang học\.\.\." : "Tìm học viên từng học\.\.\."\}/);
  assert.match(historySource, /cn\(formTextControlClassName, "pl-9"\)/);
  assert.doesNotMatch(historySource, /cn\(formTextControlClassName, "h-9/);
  assert.doesNotMatch(historySource, /focus:border-sky-300/);
});

test("class history timeline nodes are centered on their vertical rules", () => {
  assert.equal((historySource.match(/before:-left-5/g) ?? []).length, 2);
  assert.doesNotMatch(historySource, /before:-left-\[21px\]/);
});

test("class student list opens in the system right-to-left slide instead of expanding the history page", () => {
  assert.match(historySource, /const \[studentsPanelOpen, setStudentsPanelOpen\] = useState\(false\)/);
  assert.match(historySource, /aria-haspopup="dialog"/);
  assert.match(historySource, /setStudentsPanelOpen\(true\)/);
  assert.match(historySource, /function ClassEnrollmentHistorySlide/);
  assert.match(historySource, /max-w-\[520px\]/);
  assert.match(historySource, /isVisible \? "translate-x-0" : "translate-x-full"/);
  assert.match(historySource, /scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4/);
  assert.match(historySource, /motion-reduce:transition-none/);
  assert.doesNotMatch(historySource, /grid-rows-\[1fr\]/);
});

test("class student list separates active and former enrollments with scope nav bar without duplicate status labels", () => {
  assert.match(historySource, />Danh sách học viên<\/span>/);
  assert.match(historySource, />Danh sách học viên<\/h2>/);
  assert.match(historySource, /aria-label="Phạm vi danh sách học viên"/);
  assert.match(historySource, /const \[tab, setTab\] = useState<"active" \| "former">\("active"\)/);
  assert.match(historySource, /activeEnrollments = visibleEnrollments\.filter\(\(enrollment\) => enrollment\.status === "active"\)/);
  assert.match(historySource, /formerEnrollments = visibleEnrollments\.filter\(\(enrollment\) => enrollment\.status !== "active"\)/);
  assert.match(historySource, /bg-emerald-500/);
  assert.match(historySource, /bg-gray-400/);
  assert.match(historySource, /variant === "former"/);
  assert.doesNotMatch(historySource, /\{enrollment\.ended_at \? `Kết thúc.*: "Đang học"\}/);
  assert.doesNotMatch(historySource, /title="Danh sách học viên đang học"/);
});
