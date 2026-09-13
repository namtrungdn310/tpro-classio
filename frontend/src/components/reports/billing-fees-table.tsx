import { RiLockLine } from "react-icons/ri";
import { StatusPill } from "@/components/ui/status-pill";
import type { BillingFeePage } from "@/lib/api/billing-reports";

const statuses = {
  PAID: { label: "Đã thu", tone: "success" },
  UNPAID: { label: "Chưa thu", tone: "amber" },
  PARTIALLY_PAID: { label: "Đã thu một phần", tone: "amber" },
  REFUNDED: { label: "Đã hoàn tiền", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Đã hoàn một phần", tone: "neutral" },
  SUPERSEDED: { label: "Đã thay thế", tone: "neutral" },
  VOID: { label: "Đã huỷ", tone: "neutral" },
} as const;
const columns = "grid grid-cols-[minmax(0,1fr)_72px_74px_minmax(0,1fr)] items-center gap-1 px-2 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-2 sm:px-3";
const showDate = (date: string | null) => date ? date.split("-").reverse().join("/") : "—";

/** Header and body share their columns/gutter, but only fee rows scroll. */
export function BillingFeesTable({ fees }: { fees: BillingFeePage["items"] }) {
  return (
    <div role="table" aria-label="Danh sách khoản thu" className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div role="rowgroup" className="overflow-y-auto [scrollbar-gutter:stable] border-b border-gray-200 bg-gray-50">
        <div role="row" className={`${columns} table-heading-text text-gray-600`}>
          <span role="columnheader">Kỳ thu</span>
          <span role="columnheader">Hạn thu</span>
          <span role="columnheader" className="text-right">Số tiền</span>
          <span role="columnheader">Trạng thái</span>
        </div>
      </div>
      <div role="rowgroup" aria-label="Các khoản thu" tabIndex={0}
        className="max-h-[min(340px,45dvh)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] divide-y divide-gray-200 text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30">
        {fees.length === 0 ? <div role="row"><div role="cell" aria-colspan={4} className="p-6 text-center text-gray-500">Chưa có khoản học phí nào được tạo</div></div> : fees.map((fee) => {
          const displayStatus = fee.refunded_amount > 0
            ? (fee.refunded_amount >= fee.paid_amount ? "REFUNDED" : "PARTIALLY_REFUNDED")
            : fee.status === "UNPAID" && fee.paid_amount > 0 ? "PARTIALLY_PAID" : fee.status;
          const status = statuses[displayStatus as keyof typeof statuses] ?? { label: "Cần kiểm tra", tone: "neutral" as const };
          return <div role="row" key={fee.id} className={`${columns} hover:bg-gray-50/70`}>
            <div role="cell" className="min-w-0 tabular-nums text-gray-900">
              <span className="block">{showDate(fee.coverage_start)}</span>
              {!fee.coverage_start && <span className="block text-xs text-amber-800">Thiếu ngày kỳ thu</span>}
              <span className="block text-gray-500">trước {showDate(fee.coverage_end)}</span>
            </div>
            <div role="cell" className="min-w-0 whitespace-nowrap tabular-nums text-gray-700">{showDate(fee.due_date)}</div>
            <div role="cell" className="min-w-0 break-words text-right font-medium tabular-nums text-gray-900">{fee.amount.toLocaleString("vi-VN")}đ</div>
            <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1">
              <StatusPill tone={status.tone} className="h-auto min-h-5 max-w-full py-1 leading-tight">{status.label}</StatusPill>
              {fee.protected && <span role="img" aria-label="Khoản được bảo vệ" title="Khoản được bảo vệ, không được thay thế khi đổi lịch thu"><RiLockLine aria-hidden="true" className="h-3.5 w-3.5 text-gray-500" /></span>}
            </div>
          </div>;
        })}
      </div>
    </div>
  );
}
