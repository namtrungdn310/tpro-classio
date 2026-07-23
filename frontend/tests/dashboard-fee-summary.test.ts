import assert from "node:assert/strict";
import test from "node:test";
import { getCollectionRate } from "../src/components/dashboard/dashboard-fee-summary";
import { buildFinancialRingSegments } from "../src/components/dashboard/dashboard-financial-ring";

test("collection rate handles empty, refunded and oversized totals safely", () => {
  assert.equal(getCollectionRate(0, 0), 0);
  assert.equal(getCollectionRate(23_000_000, 32_000_000), 72);
  assert.equal(getCollectionRate(11_000_000, 10_000_000), 100);
  assert.equal(getCollectionRate(-1, 10_000_000), 0);
});

test("financial ring normalizes its three values without inventing a gap", () => {
  const empty = buildFinancialRingSegments(0, 0, 0);
  assert.ok(empty.every((segment) => segment.percent === 0));
  assert.ok(empty.every((segment) => segment.offsetPercent === 0));

  const segments = buildFinancialRingSegments(60, 10, 30);
  assert.deepEqual(
    segments.map((segment) => segment.percent),
    [60, 10, 30],
  );
  assert.deepEqual(
    segments.map((segment) => segment.offsetPercent),
    [0, 60, 70],
  );
  assert.equal(
    segments.reduce((sum, segment) => sum + segment.percent, 0),
    100,
  );
});
