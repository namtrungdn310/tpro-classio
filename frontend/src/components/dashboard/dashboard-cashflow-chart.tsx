"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { DASHBOARD_CHART_MOTION } from "@/components/dashboard/dashboard-chart-motion";
import type { DashboardRevenuePoint } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

type DashboardCashflowChartProps = {
  points: DashboardRevenuePoint[];
};

type CashflowChartPoint = DashboardRevenuePoint & {
  displayPeriod: string;
};

export function DashboardCashflowChart({ points }: DashboardCashflowChartProps) {
  const chart = buildCashflowChartData(points);
  const summary = chart.points
    .map(
      (point) =>
        `${point.displayPeriod}: ${formatCurrency(point.net_collected_amount)}`,
    )
    .join("; ");

  return (
    <figure
      className="mt-3 flex min-h-0 flex-1 flex-col border-t border-gray-100 pt-3"
      aria-labelledby="dashboard-cashflow-title"
      aria-describedby="dashboard-cashflow-description"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3
          id="dashboard-cashflow-title"
          className="caption-text font-semibold text-gray-700"
        >
          Dòng tiền 6 tháng
        </h3>
        {chart.comparison ? (
          <p
            className={`caption-text text-right font-medium ${
              chart.comparison.direction === "up"
                ? "text-[#1967D2]"
                : "text-gray-500"
            }`}
          >
            {chart.comparison.label}
          </p>
        ) : null}
      </div>
      <p id="dashboard-cashflow-description" className="sr-only">
        Dòng tiền thực thu theo tháng. {summary}
      </p>

      <div className="mt-2 min-h-[148px] flex-1">
        <LineChart
          accessibilityLayer
          responsive
          data={chart.points}
          margin={{ top: 12, right: 6, bottom: 0, left: 6 }}
          style={{ width: "100%", height: "100%", minHeight: 148 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#EEF1F5"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="displayPeriod"
            axisLine={false}
            tickLine={false}
            tickMargin={7}
            height={24}
            interval={0}
            tick={{ fill: "#667085", fontSize: 11, fontWeight: 500 }}
          />
          <YAxis
            hide
            domain={[
              (dataMin: number) => Math.min(0, dataMin),
              (dataMax: number) => Math.max(1, dataMax),
            ]}
            padding={{ top: 14, bottom: 10 }}
          />
          <ReferenceLine y={0} stroke="#B8C2CF" strokeWidth={1} />
          <Tooltip
            content={CashflowTooltip}
            cursor={{ stroke: "#CBD5E1", strokeDasharray: "3 3", strokeWidth: 1 }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
          />
          <Line
            type="monotone"
            dataKey="net_collected_amount"
            name="Thực thu"
            stroke="#1967D2"
            strokeWidth={2.25}
            dot={{
              fill: "#FFFFFF",
              r: 3,
              stroke: "#1967D2",
              strokeWidth: 2,
            }}
            activeDot={{
              fill: "#1967D2",
              r: 5,
              stroke: "#FFFFFF",
              strokeWidth: 2,
            }}
            isAnimationActive="auto"
            animationBegin={DASHBOARD_CHART_MOTION.begin}
            animationDuration={DASHBOARD_CHART_MOTION.duration}
            animationEasing={DASHBOARD_CHART_MOTION.easing}
          />
        </LineChart>
      </div>
    </figure>
  );
}

function CashflowTooltip({
  active,
  label,
  payload,
}: TooltipContentProps<TooltipValueType, number | string>) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value ?? 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
      <p className="caption-text font-medium text-gray-500">Tháng {String(label)}</p>
      <p className="metric-money mt-0.5 text-[13px] text-gray-950">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

export function buildCashflowChartData(points: DashboardRevenuePoint[]) {
  const orderedPoints = [...points].sort((left, right) =>
    left.period.localeCompare(right.period),
  );
  const chartPoints: CashflowChartPoint[] = orderedPoints.map((point) => ({
    ...point,
    displayPeriod: formatTrendPeriod(point.period),
  }));

  return {
    comparison: getCashflowComparison(orderedPoints),
    points: chartPoints,
  };
}

export function getCashflowComparison(points: DashboardRevenuePoint[]) {
  const orderedPoints = [...points].sort((left, right) =>
    left.period.localeCompare(right.period),
  );
  const current = orderedPoints.at(-1)?.net_collected_amount;
  const previous = orderedPoints.at(-2)?.net_collected_amount;
  if (current === undefined || previous === undefined) return null;

  const change = current - previous;
  if (change === 0) {
    return { direction: "flat" as const, label: "Không đổi so với tháng trước" };
  }

  return {
    direction: change > 0 ? ("up" as const) : ("down" as const),
    label: `${change > 0 ? "Tăng" : "Giảm"} ${formatCurrency(Math.abs(change))}`,
  };
}

export function formatTrendPeriod(period: string) {
  const [year, month] = period.split("-");
  return `${month}/${year.slice(-2)}`;
}
