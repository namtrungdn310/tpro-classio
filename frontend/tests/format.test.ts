import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactDateTime, formatDate, formatPeriod } from "../src/lib/utils/format";

test("compact dashboard update time includes dd/mm/yy and time", () => {
  const timestamp = Date.UTC(2026, 6, 13, 1, 5);

  assert.equal(formatCompactDateTime(timestamp), "13/07/26 · 08:05");
});

test("dates and billing periods use compact slash formatting", () => {
  assert.equal(formatDate("2026-07-06"), "06/07/2026");
  assert.equal(formatPeriod("2026-07"), "Tháng 7/2026");
});
