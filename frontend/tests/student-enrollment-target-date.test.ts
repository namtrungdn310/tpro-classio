import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDraftKey,
  filterEffectiveSlotsForDate,
  getBusinessTodayInVietnam,
  getDefaultTargetEnrollmentDate,
  isTargetDraftDirty,
  parseMembershipError,
  validateTargetEnrollmentDate,
} from "../src/lib/students/enrollment-target-helper";
import type { ClassResponse } from "../src/lib/types";

test("getBusinessTodayInVietnam returns current date in Asia/Ho_Chi_Minh timezone", () => {
  const vnToday = getBusinessTodayInVietnam();
  assert.match(vnToday, /^\d{4}-\d{2}-\d{2}$/);
});

test("getDefaultTargetEnrollmentDate defaults to class start_date if future, otherwise today", () => {
  const today = getBusinessTodayInVietnam();

  const futureClass = {
    id: "cls-future",
    start_date: "2099-12-01",
  } as unknown as ClassResponse;
  assert.equal(getDefaultTargetEnrollmentDate(futureClass), "2099-12-01");

  const pastClass = {
    id: "cls-past",
    start_date: "2020-01-01",
  } as unknown as ClassResponse;
  assert.equal(getDefaultTargetEnrollmentDate(pastClass), today);

  const noDateClass = {
    id: "cls-none",
    start_date: null,
  } as unknown as ClassResponse;
  assert.equal(getDefaultTargetEnrollmentDate(noDateClass), today);
});

test("validateTargetEnrollmentDate validates ISO format and leap year correctly", () => {
  // Empty
  assert.deepEqual(validateTargetEnrollmentDate(""), {
    isValid: false,
    error: "Vui lòng nhập ngày bắt đầu.",
  });
  assert.deepEqual(validateTargetEnrollmentDate(null), {
    isValid: false,
    error: "Vui lòng nhập ngày bắt đầu.",
  });

  // Malformed
  assert.deepEqual(validateTargetEnrollmentDate("2026-13-45"), {
    isValid: false,
    error: "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.",
  });
  assert.deepEqual(validateTargetEnrollmentDate("not-a-date"), {
    isValid: false,
    error: "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.",
  });

  // Leap year
  assert.deepEqual(validateTargetEnrollmentDate("2024-02-29"), {
    isValid: true,
    error: null,
  });
  assert.deepEqual(validateTargetEnrollmentDate("2025-02-29"), {
    isValid: false,
    error: "Ngày bắt đầu không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.",
  });
});

test("filterEffectiveSlotsForDate filters schedule slots by effective_from and effective_until", () => {
  const slots = [
    { id: "slot-old", effective_from: "2024-01-01", effective_until: "2024-12-31" },
    { id: "slot-current", effective_from: "2025-01-01", effective_until: null },
    { id: "slot-future", effective_from: "2026-06-01", effective_until: null },
  ];

  // For date in 2024
  const for2024 = filterEffectiveSlotsForDate(slots, "2024-06-15");
  assert.deepEqual(for2024.map((s) => s.id), ["slot-old"]);

  // For date in early 2025
  const for2025 = filterEffectiveSlotsForDate(slots, "2025-03-01");
  assert.deepEqual(for2025.map((s) => s.id), ["slot-current"]);

  // For date in late 2026
  const for2026 = filterEffectiveSlotsForDate(slots, "2026-07-01");
  assert.deepEqual(for2026.map((s) => s.id), ["slot-current", "slot-future"]);
});

test("computeDraftKey generates stable deterministic keys", () => {
  const targets = [
    { class_id: "cls-b", enrollment_date: "2026-05-01", custom_fee: 100000, selected_slot_ids: ["s2", "s1"] },
    { class_id: "cls-a", enrollment_date: "2026-04-01", custom_fee: null, selected_slot_ids: ["s3"] },
  ];

  const key1 = computeDraftKey("supplement", null, targets);
  // Re-ordering targets or slot ids should yield the exact same key
  const shuffledTargets = [
    { class_id: "cls-a", enrollment_date: "2026-04-01", custom_fee: null, selected_slot_ids: ["s3"] },
    { class_id: "cls-b", enrollment_date: "2026-05-01", custom_fee: 100000, selected_slot_ids: ["s1", "s2"] },
  ];
  const key2 = computeDraftKey("supplement", null, shuffledTargets);
  assert.equal(key1, key2);

  // Different mode yields different key
  const transferKey = computeDraftKey("transfer", "src-1", targets);
  assert.notEqual(key1, transferKey);
});

test("isTargetDraftDirty correctly detects dirty state between draft and baseline", () => {
  const baseline = {
    class_id: "cls-1",
    enrollment_date: "2026-05-01",
    custom_fee: null,
    selected_slot_ids: ["s1"],
  };
  const same = {
    class_id: "cls-1",
    enrollment_date: "2026-05-01",
    custom_fee: null,
    selected_slot_ids: ["s1"],
  };
  assert.equal(isTargetDraftDirty(same, baseline), false);

  const changedDate = {
    class_id: "cls-1",
    enrollment_date: "2026-05-02",
    custom_fee: null,
    selected_slot_ids: ["s1"],
  };
  assert.equal(isTargetDraftDirty(changedDate, baseline), true);

  const changedFee = {
    class_id: "cls-1",
    enrollment_date: "2026-05-01",
    custom_fee: 500000,
    selected_slot_ids: ["s1"],
  };
  assert.equal(isTargetDraftDirty(changedFee, baseline), true);

  assert.equal(isTargetDraftDirty(changedFee, null), true);
});

test("parseMembershipError parses 409 structured errors, 422 validations, and detail strings", () => {
  // Structured 409 conflict
  const errConflict = {
    response: {
      status: 409,
      data: {
        code: "TARGET_SCHEDULE_CONFLICT",
        message: "Lịch học của hai lớp bị trùng",
        class_id: "c1",
        conflicting_class_id: "c2",
      },
    },
  };
  assert.deepEqual(parseMembershipError(errConflict), {
    code: "TARGET_SCHEDULE_CONFLICT",
    message: "Lịch học của hai lớp bị trùng",
    class_id: "c1",
    conflicting_class_id: "c2",
  });

  // 422 array of errors
  const errValidation = {
    response: {
      status: 422,
      data: {
        detail: [
          { msg: "expected_preview_fingerprint is required", loc: ["body", "expected_preview_fingerprint"] },
        ],
      },
    },
  };
  assert.equal(
    parseMembershipError(errValidation).message,
    "expected_preview_fingerprint is required (body.expected_preview_fingerprint)",
  );

  // String detail
  const errDetail = {
    response: {
      status: 400,
      data: {
        detail: "Học viên chưa có lớp để chuyển",
      },
    },
  };
  assert.equal(
    parseMembershipError(errDetail).message,
    "Học viên chưa có lớp để chuyển",
  );
});
