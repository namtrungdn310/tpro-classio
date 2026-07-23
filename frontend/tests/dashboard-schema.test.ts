import assert from "node:assert/strict";
import test from "node:test";
import { dashboardOverviewSchema } from "../src/lib/schemas/dashboard";

test("dashboard schema accepts the minimal overview response", () => {
  const result = dashboardOverviewSchema.safeParse({
    summary: {
      period: "2026-07",
      active_student_count: 33,
      active_class_count: 12,
      weekly_session_count: 24,
      active_teacher_count: 4,
      active_assistant_count: 1,
    },
    fees: {
      total_amount: 32_000_000,
      gross_collected_amount: 24_000_000,
      refunded_amount: 1_000_000,
      net_collected_amount: 23_000_000,
      outstanding_amount: 8_000_000,
      paid_record_count: 24,
      record_count: 32,
    },
    revenue_trend: [
      { period: "2026-02", net_collected_amount: 18_000_000 },
      { period: "2026-03", net_collected_amount: 20_000_000 },
      { period: "2026-04", net_collected_amount: 19_000_000 },
      { period: "2026-05", net_collected_amount: 21_000_000 },
      { period: "2026-06", net_collected_amount: 22_000_000 },
      { period: "2026-07", net_collected_amount: 23_000_000 },
    ],
  });

  assert.equal(result.success, true);
});

test("dashboard schema rejects malformed operational data", () => {
  const result = dashboardOverviewSchema.safeParse({
    summary: {
      period: "07/2026",
      active_student_count: -1,
    },
  });

  assert.equal(result.success, false);
});

test("dashboard schema rejects a period with an impossible month", () => {
  const result = dashboardOverviewSchema.safeParse({
    summary: {
      period: "2026-99",
      active_student_count: 0,
      active_class_count: 0,
      weekly_session_count: 0,
      active_teacher_count: 0,
      active_assistant_count: 0,
    },
    fees: {
      total_amount: 0,
      gross_collected_amount: 0,
      refunded_amount: 0,
      net_collected_amount: 0,
      outstanding_amount: 0,
      paid_record_count: 0,
      record_count: 0,
    },
    revenue_trend: [],
  });

  assert.equal(result.success, false);
});

test("dashboard schema rejects malformed fee summaries", () => {
  const result = dashboardOverviewSchema.safeParse({
    summary: {
      period: "2026-07",
      active_student_count: 0,
      active_class_count: 0,
      weekly_session_count: 0,
      active_teacher_count: 0,
      active_assistant_count: 0,
    },
    fees: {
      total_amount: 10_000_000,
      gross_collected_amount: 5_000_000,
      refunded_amount: -1,
      net_collected_amount: 5_000_001,
      outstanding_amount: 5_000_000,
      paid_record_count: 4.5,
      record_count: 10,
    },
    revenue_trend: [],
  });

  assert.equal(result.success, false);
});

test("dashboard schema accepts negative net cash flow but requires six months", () => {
  const revenueTrend = [
    { period: "2026-02", net_collected_amount: 1_000_000 },
    { period: "2026-03", net_collected_amount: 2_000_000 },
    { period: "2026-04", net_collected_amount: -500_000 },
    { period: "2026-05", net_collected_amount: 0 },
    { period: "2026-06", net_collected_amount: 3_000_000 },
    { period: "2026-07", net_collected_amount: 4_000_000 },
  ];
  const base = {
    summary: {
      period: "2026-07",
      active_student_count: 0,
      active_class_count: 0,
      weekly_session_count: 0,
      active_teacher_count: 0,
      active_assistant_count: 0,
    },
    fees: {
      total_amount: 0,
      gross_collected_amount: 0,
      refunded_amount: 0,
      net_collected_amount: 0,
      outstanding_amount: 0,
      paid_record_count: 0,
      record_count: 0,
    },
  };

  assert.equal(
    dashboardOverviewSchema.safeParse({ ...base, revenue_trend: revenueTrend })
      .success,
    true,
  );
  assert.equal(
    dashboardOverviewSchema.safeParse({
      ...base,
      revenue_trend: revenueTrend.slice(1),
    }).success,
    false,
  );
});
