import assert from "node:assert/strict";
import test from "node:test";
import { applySharedEnrollmentDate } from "../src/lib/students/enrollment-fees";
import type { StudentEnrollmentInfo } from "../src/lib/types";

function enrollment(
  id: string,
  customFee: number | null,
): StudentEnrollmentInfo {
  return {
    id,
    class_id: `class-${id}`,
    class_name: `Lớp ${id}`,
    custom_fee: customFee,
    enrollment_date: "2026-06-05",
    status: "active",
  };
}

test("changing the shared start date preserves an explicitly cleared custom fee", () => {
  const enrollments = [enrollment("a", 750_000), enrollment("b", null)];

  const result = applySharedEnrollmentDate(
    enrollments,
    {
      a: { custom_fee: null, enrollment_date: "2026-06-05" },
      b: { custom_fee: 0, enrollment_date: "2026-06-05" },
    },
    "2026-07-14",
  );

  assert.deepEqual(result, {
    a: { custom_fee: null, enrollment_date: "2026-07-14" },
    b: { custom_fee: 0, enrollment_date: "2026-07-14" },
  });
});

test("changing the shared start date falls back to stored fees only when no draft exists", () => {
  const result = applySharedEnrollmentDate(
    [enrollment("a", 750_000)],
    {},
    "2026-07-14",
  );

  assert.equal(result.a.custom_fee, 750_000);
});
