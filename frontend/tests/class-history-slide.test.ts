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
  assert.match(historySource, /placeholder="Tìm học viên từng học\.\.\."/);
  assert.match(historySource, /cn\(formTextControlClassName, "h-9 pl-9"\)/);
  assert.doesNotMatch(historySource, /focus:border-sky-300/);
});
