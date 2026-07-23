import { DashboardCashflowChart } from "@/components/dashboard/dashboard-cashflow-chart";
import { DashboardFinancialRing } from "@/components/dashboard/dashboard-financial-ring";
import type { DashboardFeeSummary, DashboardRevenuePoint } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

type DashboardFeeSummaryCardProps = {
  fees: DashboardFeeSummary;
  revenueTrend: DashboardRevenuePoint[];
};

export function DashboardFeeSummaryCard({
  fees,
  revenueTrend,
}: DashboardFeeSummaryCardProps) {
  const collectionRate = getCollectionRate(
    fees.net_collected_amount,
    fees.total_amount,
  );
  const hasFees = fees.record_count > 0;

  return (
    <article
      aria-labelledby="dashboard-fee-summary-title"
      className="dashboard-fee-panel-enter relative flex min-h-[390px] flex-1 flex-col overflow-hidden rounded-[22px] border border-gray-200/90 bg-white p-4 text-gray-950 shadow-[0_16px_50px_rgba(15,23,42,0.055)]"
      style={{ animationDelay: "165ms" }}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2
          id="dashboard-fee-summary-title"
          className="table-heading-text text-[#315477]"
        >
          Tài chính học phí
        </h2>
        <p className="caption-text shrink-0 text-right text-gray-500">
          {hasFees
            ? `${fees.paid_record_count} / ${fees.record_count} khoản đã nộp`
            : "Chưa phát sinh học phí"}
        </p>
      </header>

      <div className="mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_132px] items-center gap-3">
        <div className="min-w-0 self-center">
          <p className="caption-text font-semibold text-gray-500">Thực thu ròng</p>
          <p
            className="metric-money mt-1.5 break-words text-[clamp(1.45rem,2.15vw,1.875rem)] leading-none text-gray-950"
            title={formatCurrency(fees.net_collected_amount)}
          >
            {formatCurrency(fees.net_collected_amount)}
          </p>
          <p className="caption-text mt-2 text-gray-500">
            Cần thu {formatCurrency(fees.total_amount)}
          </p>
        </div>

        <DashboardFinancialRing collectionRate={collectionRate} fees={fees} />
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-3 border-y border-gray-100 py-2.5">
        <FinancialValue
          accentClassName="bg-[#1967D2]"
          label="Thực thu"
          value={fees.net_collected_amount}
        />
        <FinancialValue
          accentClassName="bg-slate-500"
          label="Đã hoàn"
          value={fees.refunded_amount}
        />
        <FinancialValue
          accentClassName="bg-[#D7DEE8]"
          label="Còn lại"
          value={fees.outstanding_amount}
        />
      </dl>

      <DashboardCashflowChart points={revenueTrend} />
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
        className="metric-money mt-1 break-words text-[13px] leading-4 text-gray-900 sm:text-[14px]"
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

  return Math.min(100, Math.max(0, Math.round((netCollected / total) * 100)));
}
