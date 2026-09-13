import test from "node:test";
import assert from "node:assert/strict";
import { buildAcademicUpdates } from "../src/lib/students/academic-update-payload";
import type { StudentEnrollmentInfo } from "../src/lib/types";

const enrollment: StudentEnrollmentInfo = {
  id: "enrollment", class_id: "class", class_name: "6C1", class_category: "GENERAL", class_grade_mode: "GRADE",
  class_grade_level: 6, class_start_date: "2025-01-01", class_end_date: null,
  custom_fee: null, effective_fee: 750000, enrollment_date: "2026-09-01", selected_slot_ids: ["b", "a"],
  admission_version: 2, status: "active",
};

test("academic patch does not include unchanged fees, slots or financial decisions", () => {
  const result = buildAcademicUpdates([enrollment], { enrollment: {
    custom_fee: null, enrollment_date: "2026-08-01", selected_slot_ids: ["a", "b"],
  } });
  assert.deepEqual(result, [{ enrollment_id: "enrollment", enrollment_date: "2026-08-01", expected_admission_version: 2,
    billing_change_reason: "Điều chỉnh ngày ghi danh theo hồ sơ học viên" }]);
});

test("stale clients without an admission version fail closed", () => {
  assert.throws(() => buildAcademicUpdates([{ ...enrollment, admission_version: undefined }], { enrollment: {
    custom_fee: null, enrollment_date: "2026-08-01", selected_slot_ids: [],
  } }), /tải lại/);
});

test("unchanged academic form produces no update", () => {
  assert.deepEqual(buildAcademicUpdates([enrollment], { enrollment }), []);
});

test("enrollment with empty selected_slot_ids falls back to class slots and produces no update when unchanged", () => {
  const legacyEnrollment: StudentEnrollmentInfo = {
    ...enrollment,
    id: "legacy",
    selected_slot_ids: [],
  };
  const mockClasses = [
    {
      id: "class",
      schedule: {
        slots: [{ id: "slot-1" }, { id: "slot-2" }],
      },
    },
  ];
  // Draft initialized with all class slots
  const result = buildAcademicUpdates(
    [legacyEnrollment],
    { legacy: { custom_fee: null, enrollment_date: "2026-09-01", selected_slot_ids: ["slot-1", "slot-2"] } },
    undefined,
    mockClasses,
  );
  assert.deepEqual(result, []);
});

test("enrollment with empty selected_slot_ids produces patch when user explicitly modifies class slots", () => {
  const legacyEnrollment: StudentEnrollmentInfo = {
    ...enrollment,
    id: "legacy",
    selected_slot_ids: [],
  };
  const mockClasses = [
    {
      id: "class",
      schedule: {
        slots: [{ id: "slot-1" }, { id: "slot-2" }],
      },
    },
  ];
  // User unchecked slot-2
  const result = buildAcademicUpdates(
    [legacyEnrollment],
    { legacy: { custom_fee: null, enrollment_date: "2026-09-01", selected_slot_ids: ["slot-1"] } },
    undefined,
    mockClasses,
  );
  assert.deepEqual(result, [
    {
      enrollment_id: "legacy",
      selected_slot_ids: ["slot-1"],
    },
  ]);
});

