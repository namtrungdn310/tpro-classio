import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCashflowChartData,
  formatTrendPeriod,
  getCashflowComparison,
} from "../src/components/dashboard/dashboard-cashflow-chart";

test("cashflow chart orders periods and preserves positive, negative and zero values", () => {
  const chart = buildCashflowChartData([
    { period: "2026-04", net_collected_amount: 1_500_000 },
    { period: "2026-02", net_collected_amount: 0 },
    { period: "2026-03", net_collected_amount: -500_000 },
  ]);

  assert.deepEqual(
    chart.points.map((point) => ({
      amount: point.net_collected_amount,
      displayPeriod: point.displayPeriod,
      period: point.period,
    })),
    [
      { amount: 0, displayPeriod: "02/26", period: "2026-02" },
      { amount: -500_000, displayPeriod: "03/26", period: "2026-03" },
      { amount: 1_500_000, displayPeriod: "04/26", period: "2026-04" },
    ],
  );
});

test("cashflow comparison covers rising, falling and unchanged months", () => {
  assert.deepEqual(
    getCashflowComparison([
      { period: "2026-06", net_collected_amount: 1_000_000 },
      { period: "2026-07", net_collected_amount: 4_000_000 },
    ]),
    { direction: "up", label: "Tăng 3.000.000đ" },
  );
  assert.deepEqual(
    getCashflowComparison([
      { period: "2026-06", net_collected_amount: 4_000_000 },
      { period: "2026-07", net_collected_amount: 1_000_000 },
    ]),
    { direction: "down", label: "Giảm 3.000.000đ" },
  );
  assert.deepEqual(
    getCashflowComparison([
      { period: "2026-06", net_collected_amount: 0 },
      { period: "2026-07", net_collected_amount: 0 },
    ]),
    { direction: "flat", label: "Không đổi so với tháng trước" },
  );
  assert.equal(getCashflowComparison([]), null);
  assert.equal(formatTrendPeriod("2026-07"), "07/26");
});
