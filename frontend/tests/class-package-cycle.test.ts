import assert from "node:assert/strict";
import test from "node:test";
import { getDerivedCoursePackageSummary } from "../src/lib/classes/package-cycle";

test("derived package summary splits full packages and remaining days", () => {
  // R6: end date is independent of cadence; the count is a derived preview only.
  assert.deepEqual(
    getDerivedCoursePackageSummary("2026-08-13", "2026-09-03", 3),
    { fullPackages: 1, remainingDays: 0, totalDays: 21 },
  );
  // 28 ngày = 1 gói 3 tuần + 7 ngày dư — vẫn hợp lệ, chỉ hiển thị phần dư.
  assert.deepEqual(
    getDerivedCoursePackageSummary("2026-08-13", "2026-09-10", 3),
    { fullPackages: 1, remainingDays: 7, totalDays: 28 },
  );
});

test("derived package summary returns null for incomplete inputs", () => {
  assert.equal(getDerivedCoursePackageSummary("", "2027-04-10", 12), null);
  assert.equal(getDerivedCoursePackageSummary("2026-08-01", "2026-08-01", 12), null);
  assert.equal(getDerivedCoursePackageSummary("2026-08-01", "2026-08-20", 0), null);
  assert.equal(getDerivedCoursePackageSummary("2026-08-01", "2026-08-20", null), null);
});
