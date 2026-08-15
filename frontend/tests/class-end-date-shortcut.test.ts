import assert from "node:assert/strict";
import test from "node:test";
import {
  getCourseShortcutTotalWeeks,
  getExactEndDateShortcutCount,
  getSuggestedClassEndDate,
} from "../src/lib/classes/end-date-shortcut";

test("monthly shortcut follows the backend EOM minimum semantics", () => {
  assert.equal(
    getSuggestedClassEndDate({ startDate: "2026-08-13", type: "MONTHLY", count: 1 }),
    "2026-09-14",
  );
  assert.equal(
    getSuggestedClassEndDate({ startDate: "2027-01-31", type: "MONTHLY", count: 1 }),
    "2027-03-01",
  );
  assert.equal(
    getSuggestedClassEndDate({ startDate: "2026-08-13", type: "MONTHLY", count: 3 }),
    "2026-11-14",
  );
});

test("package shortcut multiplies package duration without constraining manual dates", () => {
  assert.equal(
    getSuggestedClassEndDate({
      startDate: "2026-08-13",
      type: "COURSE",
      count: 3,
      billingCycleWeeks: 3,
    }),
    "2026-10-15",
  );
  assert.equal(
    getExactEndDateShortcutCount({
      startDate: "2026-08-13",
      endDate: "2026-10-15",
      type: "COURSE",
      billingCycleWeeks: 3,
    }),
    3,
  );
  assert.equal(
    getExactEndDateShortcutCount({
      startDate: "2026-08-13",
      endDate: "2026-10-16",
      type: "COURSE",
      billingCycleWeeks: 3,
    }),
    null,
  );
});

test("invalid shortcut values never invent an end date", () => {
  assert.equal(
    getSuggestedClassEndDate({ startDate: "", type: "MONTHLY", count: 1 }),
    null,
  );
  assert.equal(
    getSuggestedClassEndDate({ startDate: "2026-08-13", type: "COURSE", count: 1 }),
    null,
  );
  assert.equal(
    getSuggestedClassEndDate({ startDate: "2026-08-13", type: "MONTHLY", count: 0 }),
    null,
  );
});

test("course total weeks multiplies duration by package count", () => {
  assert.equal(getCourseShortcutTotalWeeks(4, "4"), 16);
  assert.equal(getCourseShortcutTotalWeeks(3, 5), 15);
  assert.equal(getCourseShortcutTotalWeeks(null, "4"), null);
  assert.equal(getCourseShortcutTotalWeeks(4, ""), null);
  assert.equal(getCourseShortcutTotalWeeks(4, "0"), null);
});
