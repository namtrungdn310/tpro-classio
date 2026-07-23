import assert from "node:assert/strict";
import test from "node:test";
import {
  changeFeePeriodMonth,
  changeFeePeriodYear,
  getAscendingFeeYears,
  getFeeMonthLimit,
} from "../src/lib/fees/period";

test("orders older fee years before newer years in the filter", () => {
  assert.deepEqual(getAscendingFeeYears(new Set([2026, 2024, 2025])), [
    2024,
    2025,
    2026,
  ]);
});

test("moves every 2025 month to 2026 without producing an unavailable current-year month", () => {
  const currentPeriod = "2026-07";

  for (let month = 1; month <= 12; month += 1) {
    const historicalPeriod = `2025-${String(month).padStart(2, "0")}`;
    const expectedMonth = Math.min(month, 7);

    assert.equal(
      changeFeePeriodYear(historicalPeriod, "2026", currentPeriod),
      `2026-${String(expectedMonth).padStart(2, "0")}`,
    );
  }
});

test("period filter transitions use the latest complete period instead of a stale year/month snapshot", () => {
  const currentPeriod = "2026-07";
  const afterMonthChange = changeFeePeriodMonth(
    "2025-02",
    "11",
    currentPeriod,
  );

  assert.equal(afterMonthChange, "2025-11");
  assert.equal(
    changeFeePeriodYear(afterMonthChange, "2026", currentPeriod),
    "2026-07",
  );
  assert.equal(getFeeMonthLimit("2025", currentPeriod), 12);
  assert.equal(getFeeMonthLimit("2026", currentPeriod), 7);
});
