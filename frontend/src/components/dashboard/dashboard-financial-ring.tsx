import type { CSSProperties } from "react";
import { DASHBOARD_CHART_MOTION } from "@/components/dashboard/dashboard-chart-motion";
import type { DashboardFeeSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

type DashboardFinancialRingProps = {
  collectionRate: number;
  fees: DashboardFeeSummary;
};

export type FinancialRingSegment = {
  color: string;
  key: "net" | "refund" | "outstanding";
  label: string;
  offsetPercent: number;
  percent: number;
  value: number;
};

type RingSegmentStyle = CSSProperties & {
  "--ring-dasharray": string;
  "--ring-dashoffset": string;
};

type RingMotionStyle = CSSProperties & {
  "--dashboard-chart-motion-delay": string;
  "--dashboard-chart-motion-duration": string;
  "--dashboard-chart-motion-easing": string;
};

const SEGMENT_COLORS = {
  net: "#1967D2",
  refund: "#64748B",
  outstanding: "#D7DEE8",
} as const;

export function DashboardFinancialRing({
  collectionRate,
  fees,
}: DashboardFinancialRingProps) {
  const segments = buildFinancialRingSegments(
    fees.net_collected_amount,
    fees.refunded_amount,
    fees.outstanding_amount,
  );
  const visibleSegmentCount = segments.filter(
    (segment) => segment.percent > 0,
  ).length;
  const description = segments
    .map(
      (segment) =>
        `${segment.label} ${formatCurrency(segment.value)}, ${Math.round(segment.percent)} phần trăm`,
    )
    .join("; ");
  const motionStyle: RingMotionStyle = {
    "--dashboard-chart-motion-delay": `${DASHBOARD_CHART_MOTION.begin}ms`,
    "--dashboard-chart-motion-duration": `${DASHBOARD_CHART_MOTION.duration}ms`,
    "--dashboard-chart-motion-easing": DASHBOARD_CHART_MOTION.easing,
  };

  return (
    <div className="flex min-w-0 flex-col items-center justify-center">
      <div
        role="img"
        aria-label={`Phân bổ học phí: ${description || "chưa có dữ liệu"}.`}
        className="relative size-[132px] shrink-0"
        style={motionStyle}
      >
        <svg
          aria-hidden="true"
          className="size-full -rotate-90 overflow-visible"
          viewBox="0 0 112 112"
        >
          <circle
            cx="56"
            cy="56"
            r="44"
            pathLength="100"
            fill="none"
            stroke="#EEF1F5"
            strokeWidth="9"
          />
          {segments.map((segment) => {
            if (segment.percent <= 0) return null;
            const gap = visibleSegmentCount > 1 ? 1.25 : 0;
            const visiblePercent = Math.max(0.8, segment.percent - gap);
            const style: RingSegmentStyle = {
              "--ring-dasharray": `${visiblePercent} ${100 - visiblePercent}`,
              "--ring-dashoffset": String(-segment.offsetPercent),
            };

            return (
              <circle
                key={`${segment.key}-${visiblePercent}-${segment.offsetPercent}`}
                className="dashboard-finance-ring-segment"
                cx="56"
                cy="56"
                r="44"
                pathLength="100"
                fill="none"
                stroke={segment.color}
                strokeWidth="9"
                strokeLinecap="round"
                style={style}
              />
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            key={collectionRate}
            className="dashboard-finance-ring-value metric-value text-[25px] font-semibold leading-none text-[#1967D2]"
          >
            {collectionRate}%
          </span>
          <span className="caption-text mt-1 text-gray-500">đã thu</span>
        </div>
      </div>
    </div>
  );
}

export function buildFinancialRingSegments(
  netCollected: number,
  refunded: number,
  outstanding: number,
): FinancialRingSegment[] {
  const values = [
    {
      color: SEGMENT_COLORS.net,
      key: "net" as const,
      label: "Thực thu",
      value: Math.max(0, netCollected),
    },
    {
      color: SEGMENT_COLORS.refund,
      key: "refund" as const,
      label: "Đã hoàn",
      value: Math.max(0, refunded),
    },
    {
      color: SEGMENT_COLORS.outstanding,
      key: "outstanding" as const,
      label: "Còn lại",
      value: Math.max(0, outstanding),
    },
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let offsetPercent = 0;

  return values.map((item) => {
    const percent = total > 0 ? (item.value / total) * 100 : 0;
    const segment = { ...item, offsetPercent, percent };
    offsetPercent += percent;
    return segment;
  });
}
