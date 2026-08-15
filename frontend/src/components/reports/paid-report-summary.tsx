import { LoadingLabel } from "@/components/ui/loading-label";
import type { FeePaidReportSummary } from "@/lib/types";
import {
  getPaymentMethodDistribution,
  getPaymentMethodLabel,
} from "@/lib/reports/paid-report-view-model";
import { formatCurrency } from "@/lib/utils/format";

type PaidReportSummaryProps = {
  isRefreshing: boolean;
  summary: FeePaidReportSummary;
};

export function PaidReportSummaryBand({
  isRefreshing,
  summary,
}: PaidReportSummaryProps) {
  const distribution = getPaymentMethodDistribution(summary);

  return (
    <section
      aria-label="Tổng kết sổ thu"
      className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-[#fbfdff] px-5 py-4 sm:px-6"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-[13px] top-0 w-px bg-slate-300"
      />
      <span
        aria-hidden="true"
        className="absolute left-[10px] top-[29px] h-[7px] w-[7px] rounded-full border-2 border-white bg-primary shadow-[0_0_0_1px_var(--primary)]"
      />

      <div className="grid gap-5 pl-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)] lg:items-end">
        <div className="min-w-0">
          <div className="flex min-h-5 items-center gap-2">
            <p className="font-ui text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Thực thu
            </p>
            {isRefreshing ? (
              <span
                role="status"
                className="text-[11px] font-medium text-slate-400"
              >
                <LoadingLabel label="Đang cập nhật" />
              </span>
            ) : null}
          </div>
          <p className="metric-money mt-1 text-[30px] font-semibold leading-9 tracking-[-0.03em] text-slate-950 sm:text-[34px] sm:leading-10">
            {formatCurrency(summary.net_amount)}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
            <span>
              Đã nhận{" "}
              <strong className="font-semibold tabular-nums text-slate-700">
                {formatCurrency(summary.gross_amount)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              −
            </span>
            <span>
              Đã hoàn{" "}
              <strong className="font-semibold tabular-nums text-rose-700">
                {formatCurrency(summary.refunded_amount)}
              </strong>
            </span>
          </p>
        </div>

        <div className="min-w-0 lg:pb-0.5">
          <div className="flex items-end justify-between gap-4">
            <p className="text-[13px] leading-5 text-slate-500">
              <strong className="font-semibold tabular-nums text-slate-800">
                {summary.receipt_count}
              </strong>{" "}
              phiếu thu
              <span aria-hidden="true"> · </span>
              <strong className="font-semibold tabular-nums text-slate-800">
                {summary.student_count}
              </strong>{" "}
              học viên
            </p>
            <span className="shrink-0 text-[11px] font-medium text-slate-400">
              Theo thực thu
            </span>
          </div>
          <div
            className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100"
            aria-label={`${getPaymentMethodLabel("bank_transfer")} ${distribution.bankPercent.toFixed(1)}%, ${getPaymentMethodLabel("cash")} ${distribution.cashPercent.toFixed(1)}%`}
          >
            <span
              className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${distribution.bankPercent}%` }}
            />
            <span
              className="h-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${distribution.cashPercent}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <MethodAmount
              color="bg-primary"
              label="Chuyển khoản"
              value={summary.bank_transfer_net_amount}
            />
            <MethodAmount
              color="bg-emerald-500"
              label="Tiền mặt"
              value={summary.cash_net_amount}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
function MethodAmount({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}{" "}
      <strong className="font-semibold tabular-nums text-slate-700">
        {formatCurrency(value)}
      </strong>
    </span>
  );
}
