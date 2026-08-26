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

test("overview metrics preserve the four operational meanings", () => {
  assert.match(dashboardSource, /label="Học viên"/);
  assert.match(dashboardSource, /label="Lớp học"/);
  assert.match(dashboardSource, /label="Giáo viên"/);
  assert.match(dashboardSource, /label="Trợ giảng"/);
  assert.doesNotMatch(dashboardSource, /label="Đội ngũ"/);
  assert.match(dashboardSource, /active_student_count/);
  assert.match(dashboardSource, /active_class_count/);
  assert.match(dashboardSource, /weekly_session_count/);
  assert.match(dashboardSource, /active_teacher_count/);
  assert.match(dashboardSource, /active_assistant_count/);
  assert.match(dashboardSource, /giáo viên/i);
  assert.match(dashboardSource, /trợ giảng/i);
  assert.doesNotMatch(dashboardSource, /\bGV\b|\bTG\b/);
  assert.match(dashboardSource, /overview\.fees/);
});

test("metric cards are compact, icon-free and use one restrained accent", () => {
  assert.match(metricCardSource, /rounded-\[18px\]/);
  assert.match(metricCardSource, /bg-white/);
  assert.match(metricCardSource, /bg-primary/);
  assert.doesNotMatch(metricCardSource, /icon:/);
  assert.doesNotMatch(metricCardSource, /lucide-react|LucideIcon|<svg/);
  assert.doesNotMatch(metricCardSource, /sky-|emerald-|violet-|amber-|rose-/);
  assert.doesNotMatch(feeSummarySource, /lucide-react|LucideIcon|icon:/);
  assert.match(dashboardSource, /grid auto-rows-fr grid-cols-2 gap-3/);
  assert.doesNotMatch(dashboardSource, /featured/);
  assert.doesNotMatch(metricCardSource, /meta:/);
  assert.match(metricCardSource, /text-\[17px\]/);
  assert.match(metricCardSource, /border-slate-300/);
  assert.match(metricCardSource, /text-slate-600/);
  assert.match(feeSummarySource, /border-slate-300/);
  assert.match(feeSummarySource, /bg-slate-300/);
});

test("fee summary shows the collection rate with a creative bar and breakdown", () => {
  assert.match(feeSummarySource, /net_collected_amount/);
  assert.match(feeSummarySource, /total_amount/);
  assert.match(feeSummarySource, /outstanding_amount/);
  assert.match(feeSummarySource, /refunded_amount/);
  assert.match(feeSummarySource, /paid_record_count/);
  assert.match(feeSummarySource, /break-words/);
  assert.match(feeSummarySource, /Thực thu ròng/);
  assert.match(feeSummarySource, /Tài chính học phí/);
  assert.doesNotMatch(feeSummarySource, /formatPeriod|period:/);
  assert.doesNotMatch(feeSummarySource, /<DashboardFinancialRing|<DashboardCashflowChart/);
  assert.doesNotMatch(feeSummarySource, /recharts/);
  assert.match(feeSummarySource, /getCollectionRate/);
  assert.match(feeSummarySource, /SEGMENT_COUNT/);
  assert.doesNotMatch(feeSummarySource, /bg-gradient-to-r/);
  assert.match(feeSummarySource, /rounded-\[22px\]/);
  assert.doesNotMatch(feeSummarySource, /radial-gradient/);
  assert.doesNotMatch(feeSummarySource, /bg-gray-950|border-gray-900/);
});

test("metric skeleton mirrors the compact cards and financial summary", () => {
  assert.match(skeletonSource, /rounded-\[22px\] border border-slate-300 bg-white/);
  assert.doesNotMatch(skeletonSource, /\[72, 65, 48, 53, 31, 20\]/);
  assert.doesNotMatch(skeletonSource, /absolute inset-x-0 top-/);
  assert.doesNotMatch(skeletonSource, /rounded-\[17px\] border border-blue-100/);
  assert.match(skeletonSource, /rounded-\[18px\]/);
  assert.doesNotMatch(skeletonSource, /bg-gray-(?:800|900|950)/);
  assert.doesNotMatch(skeletonSource, /size-8 rounded-full/);
});

test("dashboard metric enter animation honors reduced motion", () => {
  assert.match(globalStyles, /@keyframes dashboard-metric-in/);
  assert.match(globalStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    globalStyles,
    /\.dashboard-metric-enter[\s\S]*animation: none/,
  );
});

test("overview schedule fits its panel without horizontal scrolling", () => {
  assert.doesNotMatch(weeklyScheduleSource, /overflow-x-auto|min-w-\[760px\]/);
  assert.match(weeklyScheduleSource, /grid-cols-\[56px_repeat\(7,minmax\(0,1fr\)\)\]/);
  assert.match(weeklyScheduleSource, /compactDayLabel/);
  assert.match(weeklyScheduleSource, /border-slate-300/);
  assert.match(weeklyScheduleSource, /border-slate-200/);
});
