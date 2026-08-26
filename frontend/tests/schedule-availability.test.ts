import assert from "node:assert/strict";
import test from "node:test";
import {
  isClassScheduleCellBlocked,
  type ScheduleConflictBlock,
} from "../src/lib/classes/schedule-availability";

const occupied: ScheduleConflictBlock[] = [
  {
    classId: "other-class",
    className: "6A1",
    day: "Thứ 2",
    start: "10:00",
    end: "11:00",
    busyTeacherIds: ["teacher-busy"],
    busyAssistantIds: [],
  },
];

test("class schedule picker blocks when all assigned teachers are busy", () => {
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 2", "10:00", ["teacher-busy"]),
    true,
  );
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 2", "10:30", ["teacher-busy"]),
    true,
  );
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 2", "11:00", ["teacher-busy"]),
    false,
  );
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 3", "10:00", ["teacher-busy"]),
    false,
  );
});

test("class schedule picker keeps cell open if at least one teacher is free", () => {
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 2", "10:00", [
      "teacher-busy",
      "teacher-free",
    ]),
    false,
  );
  assert.equal(
    isClassScheduleCellBlocked(occupied, "Thứ 2", "10:00", ["teacher-free"]),
    false,
  );
});

test("class schedule picker treats legacy blocks as occupied fail-closed", () => {
  const legacy: ScheduleConflictBlock[] = [
    { className: "Lớp cũ", day: "Thứ 4", start: "13:30", end: "15:00" },
  ];
  assert.equal(isClassScheduleCellBlocked(legacy, "Thứ 4", "14:00"), true);
});
