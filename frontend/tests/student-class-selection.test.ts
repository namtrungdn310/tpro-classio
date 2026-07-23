import assert from "node:assert/strict";
import test from "node:test";
import { filterAndSortClassSelection } from "../src/lib/students/class-selection";
import type { ClassResponse, ClassType } from "../src/lib/types";

function makeClass(
  id: string,
  name: string,
  type: ClassType,
  billingCycleMonths: number,
): ClassResponse {
  return {
    id,
    name,
    type,
    base_fee: 1_000_000,
    billing_cycle_months: billingCycleMonths,
    start_date: null,
    end_date: null,
    schedule: null,
    teacher_id: null,
    teacher_ids: [],
    teacher_name: null,
    teacher_names: [],
    is_active: true,
    student_count: 0,
    created_at: "2026-07-13T00:00:00Z",
  };
}

const classes = [
  makeClass("ielts", "IELTS Chuyên sâu", "COURSE", 6),
  makeClass("grade-7", "7C1", "MONTHLY", 1),
  makeClass("grade-6", "6C1", "MONTHLY", 1),
  makeClass("gifted", "Học sinh giỏi thành phố lớp 9", "COURSE", 3),
];

test("student class selection search is accent and case insensitive", () => {
  const result = filterAndSortClassSelection(classes, {
    duration: "",
    search: "chuyen sau",
    type: "",
  });

  assert.deepEqual(result.map((class_) => class_.id), ["ielts"]);
});

test("student class selection combines type and dynamic duration filters", () => {
  const result = filterAndSortClassSelection(classes, {
    duration: "3",
    search: "",
    type: "COURSE",
  });

  assert.deepEqual(result.map((class_) => class_.id), ["gifted"]);
});

test("student class selection uses the shared semantic class order", () => {
  const result = filterAndSortClassSelection(classes, {
    duration: "",
    search: "",
    type: "",
  });

  assert.deepEqual(result.map((class_) => class_.id), ["grade-6", "grade-7", "gifted", "ielts"]);
});
