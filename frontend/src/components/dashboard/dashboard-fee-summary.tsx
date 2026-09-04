import type { DashboardFeeSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FinancialAmount } from "@/components/ui/financial-amount";
import { FinancialPrivacyToggle } from "@/components/layout/financial-privacy-toggle";
import { useFinancialPrivacy } from "@/components/providers/financial-privacy-provider";
import { FINANCIAL_AMOUNT_MASK } from "@/lib/financial-privacy";

type DashboardFeeSummaryCardProps = {
  className?: string;
  fees: DashboardFeeSummary;
};

const SEGMENT_COUNT = 44;

export function DashboardFeeSummaryCard({
  className,
  fees,
}: DashboardFeeSummaryCardProps) {
  const { isFinancialPrivacyHidden } = useFinancialPrivacy();
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
        "dashboard-fee-panel-enter relative flex min-h-[160px] flex-col overflow-hidden rounded-[22px] border border-slate-300 bg-white px-5 py-4 text-gray-950 shadow-[0_16px_50px_rgba(15,23,42,0.08)]",
        className,
      )}
      style={{ animationDelay: "110ms" }}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="dashboard-fee-summary-title"
            className="table-heading-text text-primary"
          >
            Tài chính học phí
          </h2>
          <FinancialPrivacyToggle />
        </div>
        <p className="caption-text shrink-0 text-right text-slate-600">
          {hasFees ? (
            <>
              <span aria-label={isFinancialPrivacyHidden ? "Số khoản đã nộp đang được ẩn" : undefined}>
                {isFinancialPrivacyHidden
                  ? FINANCIAL_AMOUNT_MASK
                  : `${fees.paid_record_count} / ${fees.record_count}`}
              </span>{" "}
              khoản đã nộp
            </>
          ) : (
            "Chưa phát sinh học phí"
          )}
        </p>
      </header>

      <div className="mt-3 flex min-w-0 items-center gap-4">
        <p
          className="metric-value shrink-0 text-[26px] font-semibold leading-none text-primary"
          aria-label={isFinancialPrivacyHidden ? "Tỷ lệ đã thu đang được ẩn" : `Tỷ lệ đã thu ${collectionRate.toFixed(1)} phần trăm`}
        >
          {isFinancialPrivacyHidden ? "••••" : `${collectionRate.toFixed(1)}%`}
        </p>
        <div className="min-w-0 flex-1">
          <div
            className="flex w-full items-end gap-[2px]"
            role="img"
            aria-label={isFinancialPrivacyHidden ? "Tiến độ thu đang được ẩn" : `Tỷ lệ đã thu ${collectionRate.toFixed(1)} phần trăm trên ${SEGMENT_COUNT} mức`}
          >
            {Array.from({ length: SEGMENT_COUNT }).map((_, index) => {
              if (!isFinancialPrivacyHidden && index < completedSegments) {
                return (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="min-w-0 flex-1 aspect-square bg-primary"
                  />
                );
              }
              if (!isFinancialPrivacyHidden && index === completedSegments && activeSegmentRatio > 0) {
                return (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="relative min-w-0 flex-1 aspect-square overflow-hidden bg-slate-300"
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
                  className="min-w-0 flex-1 aspect-square bg-slate-300"
                />
              );
            })}
          </div>

          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-slate-300">
            <div
              className={cn(
                "h-full rounded-full transition-transform duration-200 ease-linear",
                isFinancialPrivacyHidden ? "bg-transparent" : "bg-primary",
              )}
              style={{
                transform: `scaleX(${isFinancialPrivacyHidden ? 0 : activeSegmentRatio})`,
                transformOrigin: "left",
              }}
            />
          </div>

          <p className="caption-text mt-1.5 text-slate-600">
            {hasFees ? "đã thu học phí" : "chưa phát sinh học phí"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-6">
        <div className="min-w-0">
          <p className="caption-text font-semibold text-slate-600">
            Thực thu ròng
          </p>
          <FinancialAmount
            amount={fees.net_collected_amount}
            className="metric-money mt-0.5 inline-block break-words text-[clamp(1rem,1.2vw,1.2rem)] leading-tight text-gray-950"
          />
        </div>
        <div className="min-w-0">
          <p className="caption-text font-semibold text-slate-600">Tổng học phí kỳ này</p>
          <FinancialAmount
            amount={fees.total_amount}
            className="metric-money mt-0.5 inline-block break-words text-[clamp(1rem,1.2vw,1.2rem)] leading-tight text-slate-700"
          />
        </div>
      </div>

      <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-200 pt-2">
        <FinancialValue
          accentClassName="bg-slate-500"
          label="Đã hoàn"
          value={fees.refunded_amount}
        />
        <FinancialValue
          accentClassName="bg-slate-400"
          label="Chưa thu"
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
      <dt className="caption-text flex items-center gap-1.5 text-slate-600">
        <span
          aria-hidden="true"
          className={`h-1 w-3 shrink-0 rounded-full ${accentClassName}`}
        />
        {label}
      </dt>
      <dd className="metric-money mt-0.5 break-words text-[12px] leading-4 text-gray-900 sm:text-[13px]">
        <FinancialAmount amount={value} />
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
