import assert from "node:assert/strict";
import test from "node:test";

import { getEnrollmentFeeSuggestion } from "../src/lib/students/enrollment-pricing";

const slots = [
  { day: "Thứ 2", start: "18:00", end: "19:30" },
  { day: "Thứ 4", start: "18:00", end: "19:30" },
] as const;

test("suggests half the class fee for one of two equal sessions", () => {
  const suggestion = getEnrollmentFeeSuggestion(700_000, [...slots], [slots[0]]);
  assert.equal(suggestion?.amount, 350_000);
  assert.equal(suggestion?.selectedCount, 1);
  assert.equal(suggestion?.totalCount, 2);
});

test("weights unequal sessions by duration instead of raw count", () => {
  const unequal = [
    { day: "Thứ 2", start: "18:00", end: "19:00" },
    { day: "Thứ 4", start: "18:00", end: "20:00" },
  ] as const;
  assert.equal(getEnrollmentFeeSuggestion(900_000, [...unequal], [unequal[0]])?.amount, 300_000);
});

test("does not suggest a custom fee for the full schedule or no selection", () => {
  assert.equal(getEnrollmentFeeSuggestion(700_000, [...slots], [...slots]), null);
  assert.equal(getEnrollmentFeeSuggestion(700_000, [...slots], []), null);
});
