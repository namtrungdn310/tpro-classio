import assert from "node:assert/strict";
import test from "node:test";
import { getCollectionRate } from "../src/components/dashboard/dashboard-fee-summary";

test("collection rate handles empty, refunded and oversized totals safely", () => {
  assert.equal(getCollectionRate(0, 0), 0);
  assert.equal(getCollectionRate(23_000_000, 32_000_000), 71.9);
  assert.equal(getCollectionRate(11_000_000, 10_000_000), 100);
  assert.equal(getCollectionRate(-1, 10_000_000), 0);
});
