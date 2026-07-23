import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../src/app/(dashboard)/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const metricCardSource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-metric-card.tsx",
    import.meta.url,
  ),
  "utf8",
);
const feeSummarySource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-fee-summary.tsx",
    import.meta.url,
  ),
  "utf8",
);
const financialRingSource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-financial-ring.tsx",
    import.meta.url,
  ),
  "utf8",
);
const cashflowChartSource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-cashflow-chart.tsx",
    import.meta.url,
  ),
  "utf8",
);
const chartMotionSource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-chart-motion.ts",
    import.meta.url,
  ),
  "utf8",
);
const skeletonSource = readFileSync(
  new URL(
    "../src/components/dashboard/dashboard-overview-skeleton.tsx",
    import.meta.url,
  ),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const weeklyScheduleSource = readFileSync(
  new URL(
    "../src/components/layout/weekly-schedule-board.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("overview metrics preserve the three operational meanings", () => {
  assert.match(dashboardSource, /label="Học viên"/);
  assert.match(dashboardSource, /label="Lớp học"/);
  assert.match(dashboardSource, /label="Đội ngũ"/);
  assert.match(dashboardSource, /active_student_count/);
  assert.match(dashboardSource, /active_class_count/);
  assert.match(dashboardSource, /weekly_session_count/);
  assert.match(dashboardSource, /active_teacher_count/);
  assert.match(dashboardSource, /active_assistant_count/);
  assert.match(dashboardSource, /giáo viên/);
  assert.match(dashboardSource, /trợ giảng/);
  assert.doesNotMatch(dashboardSource, /\bGV\b|\bTG\b/);
  assert.match(dashboardSource, /overview\.fees/);
});

test("metric cards are compact, icon-free and use one restrained accent", () => {
  assert.match(metricCardSource, /rounded-\[18px\]/);
  assert.match(metricCardSource, /bg-white/);
  assert.match(metricCardSource, /#1967D2/);
  assert.doesNotMatch(metricCardSource, /lucide-react|LucideIcon|<svg|icon:/);
  assert.doesNotMatch(metricCardSource, /sky-|emerald-|violet-|amber-|rose-/);
  assert.doesNotMatch(feeSummarySource, /lucide-react|LucideIcon|icon:/);
  assert.match(dashboardSource, /grid grid-cols-3 gap-2\.5/);
  assert.doesNotMatch(dashboardSource, /featured/);
  assert.doesNotMatch(metricCardSource, /meta:/);
  assert.match(metricCardSource, /text-\[32px\]/);
});

test("fee summary combines a financial ring with direct cashflow values", () => {
  assert.match(feeSummarySource, /net_collected_amount/);
  assert.match(feeSummarySource, /total_amount/);
  assert.match(feeSummarySource, /outstanding_amount/);
  assert.match(feeSummarySource, /refunded_amount/);
  assert.match(feeSummarySource, /paid_record_count/);
  assert.match(feeSummarySource, /break-words/);
  assert.match(feeSummarySource, /Thực thu ròng/);
  assert.match(feeSummarySource, /Tài chính học phí/);
  assert.doesNotMatch(feeSummarySource, /formatPeriod|period:/);
  assert.match(feeSummarySource, /revenueTrend/);
  assert.match(feeSummarySource, /<DashboardFinancialRing/);
  assert.match(feeSummarySource, /<DashboardCashflowChart/);
  assert.match(financialRingSource, /<svg/);
  assert.match(financialRingSource, /pathLength="100"/);
  assert.match(financialRingSource, /role="img"/);
  assert.match(financialRingSource, /dashboard-finance-ring-segment/);
  assert.match(financialRingSource, /--ring-dasharray/);
  assert.match(financialRingSource, /--ring-dashoffset/);
  assert.match(cashflowChartSource, /Dòng tiền 6 tháng/);
  assert.match(cashflowChartSource, /<figure/);
  assert.match(cashflowChartSource, /from "recharts"/);
  assert.match(cashflowChartSource, /<LineChart/);
  assert.match(cashflowChartSource, /<Line/);
  assert.match(cashflowChartSource, /responsive/);
  assert.match(cashflowChartSource, /<Tooltip/);
  assert.match(cashflowChartSource, /isAnimationActive="auto"/);
  assert.match(cashflowChartSource, /DASHBOARD_CHART_MOTION\.duration/);
  assert.match(cashflowChartSource, /className="mt-3 flex min-h-0 flex-1 flex-col/);
  assert.match(cashflowChartSource, /className="mt-2 min-h-\[148px\] flex-1"/);
  assert.match(cashflowChartSource, /margin=\{\{ top: 12, right: 6, bottom: 0, left: 6 \}\}/);
  assert.doesNotMatch(cashflowChartSource, /BarChart|<Bar|<Cell|ResponsiveContainer/);
  assert.doesNotMatch(cashflowChartSource, /magnitudePercent|isNegative|isZero/);
  assert.match(feeSummarySource, /rounded-\[22px\]/);
  assert.doesNotMatch(feeSummarySource, /radial-gradient|linear-gradient/);
  assert.doesNotMatch(
    feeSummarySource,
    /bg-gray-950|border-gray-900/,
  );
});

test("metric skeleton mirrors the compact cards and financial summary", () => {
  assert.match(skeletonSource, /rounded-\[22px\] border border-gray-200 bg-white/);
  assert.match(skeletonSource, /Array\.from\(\{ length: 6 \}\)/);
  assert.match(skeletonSource, /size-\[132px\][\s\S]*rounded-full[\s\S]*border-\[9px\]/);
  assert.match(skeletonSource, /\[72, 65, 48, 53, 31, 20\]/);
  assert.doesNotMatch(skeletonSource, /rounded-\[17px\] border border-blue-100/);
  assert.match(skeletonSource, /rounded-\[18px\]/);
  assert.doesNotMatch(skeletonSource, /bg-gray-(?:800|900|950)/);
  assert.doesNotMatch(skeletonSource, /size-8 rounded-full/);
});

test("dashboard chart motion shares one timeline and honors reduced motion", () => {
  assert.match(globalStyles, /@keyframes dashboard-metric-in/);
  assert.match(globalStyles, /@keyframes dashboard-ring-reveal/);
  assert.match(globalStyles, /\.dashboard-finance-ring-segment/);
  assert.match(globalStyles, /stroke-dasharray: 0 100/);
  assert.match(chartMotionSource, /duration: 860/);
  assert.match(chartMotionSource, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.doesNotMatch(financialRingSource, /index \* 55/);
  assert.match(financialRingSource, /DASHBOARD_CHART_MOTION\.duration/);
  assert.match(globalStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    globalStyles,
    /\.dashboard-finance-ring-segment[\s\S]*animation: none/,
  );
  assert.match(globalStyles, /\.dashboard-finance-ring-value/);
});

test("overview schedule fits its panel without horizontal scrolling", () => {
  assert.doesNotMatch(weeklyScheduleSource, /overflow-x-auto|min-w-\[760px\]/);
  assert.match(weeklyScheduleSource, /grid-cols-\[56px_repeat\(7,minmax\(0,1fr\)\)\]/);
  assert.match(weeklyScheduleSource, /compactDayLabel/);
});
