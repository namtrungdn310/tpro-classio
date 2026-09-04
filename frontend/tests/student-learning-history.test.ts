import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildStudentLearningHistoryLayout } from "../src/components/students/student-learning-history-layout";
import type { EnrollmentResponse } from "../src/lib/types";

function enrollment(
  id: string,
  classId: string,
  date: string,
  previousClassId: string | null = null,
  status: EnrollmentResponse["status"] = "completed",
): EnrollmentResponse {
  return {
    id,
    student_id: "00000000-0000-4000-8000-000000000010",
    class_id: classId,
    custom_fee: null,
    status,
    enrollment_date: date,
    ended_at: null,
    end_reason: null,
    class_name: `Lớp ${id}`,
    class_category: "GENERAL",
    class_grade_mode: "GRADE",
    class_grade_level: 6,
    class_start_date: date,
    class_end_date: null,
    previous_class_id: previousClassId,
    effective_fee: 750_000,
    selected_slot_ids: [],
    selected_slots: [],
  };
}

test("learning history puts current classes first, then newest history, and joins every node", () => {
  const firstClassId = "00000000-0000-4000-8000-000000000101";
  const secondClassId = "00000000-0000-4000-8000-000000000102";
  const unrelatedClassId = "00000000-0000-4000-8000-000000000103";
  const layout = buildStudentLearningHistoryLayout([
    enrollment("c", unrelatedClassId, "2027-08-20", null, "cancelled"),
    enrollment("b", secondClassId, "2027-06-20", firstClassId, "active"),
    enrollment("a", firstClassId, "2026-06-20"),
  ]);

  assert.deepEqual(layout.map((item) => item.enrollment.id), ["b", "c", "a"]);
  assert.equal(layout[0]?.connectsToPrevious, false);
  assert.equal(layout[0]?.connectsToNext, true);
  assert.equal(layout[1]?.connectsToPrevious, true);
  assert.equal(layout[1]?.connectsToNext, true);
  assert.equal(layout[2]?.connectsToPrevious, true);
  assert.equal(layout[2]?.connectsToNext, false);
});

test("learning history uses one progressive-disclosure list without duplicate heading", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/components/students/student-learning-history.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{`learning-history-/);
  assert.match(source, /Chưa có dữ liệu lịch học/);
  assert.match(source, /StudentLearningHistorySkeleton/);
  assert.match(source, /border-primary bg-gray-950/);
  assert.match(source, /border-destructive bg-destructive/);
  assert.match(source, /border-primary bg-primary/);
  assert.match(source, /w-px -translate-x-1\/2 bg-gray-300/);
  assert.doesNotMatch(source, /rotate-45 rounded-\[2px\]/);
  assert.doesNotMatch(source, /<h2[^>]*>\s*Lịch sử học tập/);
});
