import type { DashboardFeeSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";

type DashboardFeeSummaryCardProps = {
  className?: string;
  fees: DashboardFeeSummary;
};

const SEGMENT_COUNT = 44;

export function DashboardFeeSummaryCard({
  className,
  fees,
}: DashboardFeeSummaryCardProps) {
  const collectionRate = getCollectionRate(
    fees.net_collected_amount,
    fees.total_amount,
  );
  const hasFees = fees.record_count > 0;
  const overallRatio = collectionRate / 100;
  const exactSegments = overallRatio * SEGMENT_COUNT;
  const completedSegments = Math.floor(exactSegments);
  const activeSegmentRatio = Math.max(
    0,
    Math.min(1, exactSegments - completedSegments),
  );

  return (
    <article
      aria-labelledby="dashboard-fee-summary-title"
      className={cn(
        "dashboard-fee-panel-enter relative flex min-h-[160px] flex-col overflow-hidden rounded-[22px] border border-primary/10 bg-white px-5 py-4 text-gray-950 shadow-[0_16px_50px_rgba(0,39,135,0.06)]",
        className,
      )}
      style={{ animationDelay: "110ms" }}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2
          id="dashboard-fee-summary-title"
          className="table-heading-text text-primary"
        >
          Tài chính học phí
        </h2>
        <p className="caption-text shrink-0 text-right text-gray-500">
          {hasFees
            ? `${fees.paid_record_count} / ${fees.record_count} khoản đã nộp`
            : "Chưa phát sinh học phí"}
        </p>
      </header>

      <div className="mt-3 flex min-w-0 items-center gap-4">
        <p
          className="metric-value shrink-0 text-[26px] font-semibold leading-none text-primary"
          aria-label={`Tỷ lệ đã thu ${collectionRate.toFixed(1)} phần trăm`}
        >
          {collectionRate.toFixed(1)}%
        </p>
        <div className="min-w-0 flex-1">
          <div
            className="flex w-full items-end gap-[2px]"
            role="img"
            aria-label={`Tỷ lệ đã thu ${collectionRate.toFixed(1)} phần trăm trên ${SEGMENT_COUNT} mức`}
          >
            {Array.from({ length: SEGMENT_COUNT }).map((_, index) => {
              if (index < completedSegments) {
                return (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="min-w-0 flex-1 aspect-square bg-primary"
                  />
                );
              }
              if (index === completedSegments && activeSegmentRatio > 0) {
                return (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="relative min-w-0 flex-1 aspect-square overflow-hidden bg-slate-200"
                  >
                    <span
                      className="absolute inset-y-0 left-0 bg-primary"
                      style={{ width: `${activeSegmentRatio * 100}%` }}
                    />
                  </span>
                );
              }
              return (
                <span
                  key={index}
                  aria-hidden="true"
                  className="min-w-0 flex-1 aspect-square bg-slate-200"
                />
              );
            })}
          </div>

          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-primary transition-transform duration-200 ease-linear"
              style={{
                transform: `scaleX(${activeSegmentRatio})`,
                transformOrigin: "left",
              }}
            />
          </div>

          <p className="caption-text mt-1.5 text-gray-500">
            {hasFees ? "đã thu học phí" : "chưa phát sinh học phí"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-6">
        <div className="min-w-0">
          <p className="caption-text font-semibold text-gray-500">
            Thực thu ròng
          </p>
          <p
            className="metric-money mt-0.5 break-words text-[clamp(1rem,1.2vw,1.2rem)] leading-tight text-gray-950"
            title={formatCurrency(fees.net_collected_amount)}
          >
            <span className="inline-block translate-y-[0.07em]">
              {formatCurrency(fees.net_collected_amount)}
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="caption-text font-semibold text-gray-500">Cần thu</p>
          <p
            className="metric-money mt-0.5 break-words text-[clamp(1rem,1.2vw,1.2rem)] leading-tight text-gray-500"
            title={formatCurrency(fees.total_amount)}
          >
            <span className="inline-block translate-y-[0.07em]">
              {formatCurrency(fees.total_amount)}
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-100 pt-2">
        <FinancialValue
          accentClassName="bg-primary"
          label="Thực thu"
          value={fees.net_collected_amount}
        />
        <FinancialValue
          accentClassName="bg-slate-500"
          label="Đã hoàn"
          value={fees.refunded_amount}
        />
        <FinancialValue
          accentClassName="bg-slate-400"
          label="Còn lại"
          value={fees.outstanding_amount}
        />
      </dl>
    </article>
  );
}

function FinancialValue({
  accentClassName,
  label,
  value,
}: {
  accentClassName: string;
  label: string;
  value: number;
}) {
  return (
    <div className="min-w-0">
      <dt className="caption-text flex items-center gap-1.5 text-gray-500">
        <span
          aria-hidden="true"
          className={`h-1 w-3 shrink-0 rounded-full ${accentClassName}`}
        />
        {label}
      </dt>
      <dd
        className="metric-money mt-0.5 break-words text-[12px] leading-4 text-gray-900 sm:text-[13px]"
        title={formatCurrency(value)}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

export function getCollectionRate(netCollected: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Number(((netCollected / total) * 100).toFixed(1))),
  );
}
