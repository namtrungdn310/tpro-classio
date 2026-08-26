import { LoadingLabel } from "@/components/ui/loading-label";
import type { FeePaidReportSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

type PaidReportSummaryProps = {
  isRefreshing: boolean;
  summary: FeePaidReportSummary;
};

/** Compact financial overview aligned with the density of the Fees page. */
export function PaidReportSummaryBand({ isRefreshing, summary }: PaidReportSummaryProps) {
  return (
    <section aria-label="Tổng kết sổ thu" className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.35fr_repeat(3,minmax(150px,0.65fr))] xl:items-center">
        <div className="min-w-0 border-b border-gray-100 pb-3 sm:col-span-2 xl:col-span-1 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-5">
          <div className="flex min-h-5 items-center gap-2">
            <p className="text-[13px] font-medium text-gray-500">Thực thu</p>
            {isRefreshing ? <span role="status" className="text-[13px] text-gray-500"><LoadingLabel label="Đang cập nhật" /></span> : null}
          </div>
          <p className="metric-money mt-0.5 text-2xl font-semibold leading-8 text-gray-950 sm:text-[26px]">
            {formatCurrency(summary.net_amount)}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-gray-500">
            {summary.receipt_count} phiếu thu · {summary.student_count} học viên
          </p>
        </div>
        <SummaryMetric label="Đã nhận" value={formatCurrency(summary.gross_amount)} />
        <SummaryMetric label="Đã hoàn" value={formatCurrency(summary.refunded_amount)} />
        <SummaryMetric label="Chuyển khoản / tiền mặt" value={`${formatCurrency(summary.bank_transfer_net_amount)} / ${formatCurrency(summary.cash_net_amount)}`} compact />
      </div>
    </section>
  );
}

function SummaryMetric({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-[13px] font-medium leading-5 text-gray-500">{label}</p>
      <p className={`mt-0.5 truncate font-semibold tabular-nums text-gray-950 ${compact ? "text-[14px]" : "text-[15px]"}`}>{value}</p>
    </div>
  );
}
