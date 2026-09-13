"use client";

import { RiArrowRightSLine as ChevronRight } from "react-icons/ri";
import { LoadingLabel } from "@/components/ui/loading-label";
import type { FeePaidReceiptSummary } from "@/lib/types";
import {
  getPaidReceiptActor,
  getPaidReceiptClassSummary,
  getPaidReceiptCode,
  getPaymentMethodLabel,
  getPaymentOriginLabel,
  PAID_RECEIPT_REFUND_META,
} from "@/lib/reports/paid-report-view-model";
import {
  formatCurrency,
  formatDate,
  formatPeriod,
} from "@/lib/utils/format";
import { formatStudentCode } from "@/lib/students/student-code";

type PaidReceiptTableProps = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onPrefetch: (receiptId: string) => void;
  onPrefetchLeave: (receiptId: string) => void;
  onSelect: (receiptId: string) => void;
  receipts: FeePaidReceiptSummary[];
  selectedId: string | null;
};

const RECEIPT_GRID_CLASS =
  "grid grid-cols-[minmax(0,20fr)_minmax(0,22fr)_minmax(0,14fr)_minmax(0,17fr)_minmax(0,14fr)_minmax(0,15fr)]";

export function PaidReceiptTable({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onPrefetch,
  onPrefetchLeave,
  onSelect,
  receipts,
  selectedId,
}: PaidReceiptTableProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain xl:hidden">
        <div className="divide-y divide-slate-200">
          {receipts.map((receipt) => (
            <MobileReceipt
              key={receipt.receipt_id}
              receipt={receipt}
              selected={selectedId === receipt.receipt_id}
              onPrefetch={onPrefetch}
              onPrefetchLeave={onPrefetchLeave}
              onSelect={onSelect}
            />
          ))}
        </div>
        <LoadMore
          hasNextPage={hasNextPage}
          isFetching={isFetchingNextPage}
          onLoadMore={onLoadMore}
        />
      </div>

      <div
        role="table"
        aria-label="Danh sách phiếu thu học phí đã nộp"
        className="hidden h-full min-h-0 flex-col overflow-hidden xl:flex"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div role="row" className={`${RECEIPT_GRID_CLASS} table-heading-text select-none text-left text-gray-600`}>
            <div role="columnheader" className="whitespace-nowrap py-3 pl-5 pr-3">
              Học viên
            </div>
            <div role="columnheader" className="whitespace-nowrap px-3 py-3">
              Lớp · kỳ
            </div>
            <div role="columnheader" className="whitespace-nowrap px-3 py-3">
              Ngày nộp
            </div>
            <div role="columnheader" className="whitespace-nowrap px-3 py-3">
              Hình thức
            </div>
            <div role="columnheader" className="whitespace-nowrap px-3 py-3 text-right">
              Đã nhận
            </div>
            <div role="columnheader" className="whitespace-nowrap px-3 py-3 text-right">
              Thực thu
            </div>
          </div>
        </div>

        <div role="rowgroup" className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="divide-y divide-slate-200 text-[15px] font-medium leading-5 text-slate-700">
            {receipts.map((receipt) => (
              <ReceiptRow
                key={receipt.receipt_id}
                receipt={receipt}
                selected={selectedId === receipt.receipt_id}
                onPrefetch={onPrefetch}
                onPrefetchLeave={onPrefetchLeave}
                onSelect={onSelect}
              />
            ))}
          </div>
          <LoadMore
            hasNextPage={hasNextPage}
            isFetching={isFetchingNextPage}
            onLoadMore={onLoadMore}
          />
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({
  onPrefetch,
  onPrefetchLeave,
  onSelect,
  receipt,
  selected,
}: {
  onPrefetch: (receiptId: string) => void;
  onPrefetchLeave: (receiptId: string) => void;
  onSelect: (receiptId: string) => void;
  receipt: FeePaidReceiptSummary;
  selected: boolean;
}) {
  const state = PAID_RECEIPT_REFUND_META[receipt.refund_state];
  const isReversed = receipt.refund_state === "REVERSED";

  return (
    <div
      role="row"
      onClick={() => onSelect(receipt.receipt_id)}
      onMouseEnter={() => onPrefetch(receipt.receipt_id)}
      onMouseLeave={() => onPrefetchLeave(receipt.receipt_id)}
      className={`${RECEIPT_GRID_CLASS} group relative cursor-pointer transition-colors duration-150 motion-reduce:transition-none ${
        selected ? "bg-slate-100/70" : "hover:bg-slate-100/60"
      } ${isReversed ? "text-slate-400" : ""}`}
    >
      <div role="cell" className="relative min-w-0 py-3 pl-5 pr-3">
        {selected ? (
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-[11px] top-2 w-[3px] rounded-full bg-primary"
          />
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(receipt.receipt_id);
          }}
          onFocus={() => onPrefetch(receipt.receipt_id)}
          aria-current={selected ? "true" : undefined}
          aria-label={`Xem ${getPaidReceiptCode(receipt.payment_operation_id)} của ${receipt.student_name}`}
          className="block min-w-0 max-w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <span className="block truncate font-semibold text-slate-900">
            {receipt.student_name}
          </span>
          <span className="mt-1 block text-[13px] font-medium tabular-nums text-gray-500">
            {receipt.student_code ? formatStudentCode(receipt.student_code) : getPaidReceiptCode(receipt.payment_operation_id)}
          </span>
        </button>
      </div>
      <div role="cell" className="min-w-0 px-3 py-3">
        <span className="block truncate text-slate-800">
          {getPaidReceiptClassSummary(receipt)}
        </span>
        <span className="mt-1 block truncate text-[13px] font-normal text-gray-500">
          {receipt.period ? formatPeriod(receipt.period) : "Nhiều kỳ học phí"}
        </span>
      </div>
      <div role="cell" className="px-3 py-3 tabular-nums">
        <time dateTime={receipt.paid_at} className="whitespace-nowrap">
          {formatDate(receipt.paid_date)}
        </time>
        <span className="mt-1 block text-[13px] font-normal text-gray-500">
          {formatPaidTime(receipt.paid_at)}
        </span>
      </div>
      <div role="cell" className="min-w-0 px-3 py-3 text-slate-700">
        <span className="block truncate">{getPaymentMethodLabel(receipt.payment_method)}</span>
        <span className="mt-1 block truncate text-xs font-normal text-slate-500">
          {getPaymentOriginLabel(receipt.payment_origin)}
        </span>
      </div>
      <div role="cell" className="px-3 py-3 text-right">
        <span className="block whitespace-nowrap tabular-nums text-gray-700">{formatCurrency(receipt.gross_amount)}</span>
        {receipt.refunded_amount > 0 ? <span className="mt-1 block text-[13px] tabular-nums text-rose-700">Hoàn {formatCurrency(receipt.refunded_amount)}</span> : null}
      </div>
      <div role="cell" className="px-3 py-3 text-right">
        <span
          className={`block whitespace-nowrap font-semibold tabular-nums ${
            isReversed ? "text-slate-400 line-through" : "text-slate-950"
          }`}
        >
          {formatCurrency(receipt.net_amount)}
        </span>
        {receipt.refund_state !== "NONE" ? (
          <span
            className={`mt-1 inline-flex text-xs font-medium ${getStateTextClass(state.tone)}`}
          >
            {state.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MobileReceipt({
  onPrefetch,
  onPrefetchLeave,
  onSelect,
  receipt,
  selected,
}: {
  onPrefetch: (receiptId: string) => void;
  onPrefetchLeave: (receiptId: string) => void;
  onSelect: (receiptId: string) => void;
  receipt: FeePaidReceiptSummary;
  selected: boolean;
}) {
  const state = PAID_RECEIPT_REFUND_META[receipt.refund_state];

  return (
    <button
      type="button"
      onClick={() => onSelect(receipt.receipt_id)}
      onFocus={() => onPrefetch(receipt.receipt_id)}
      onMouseEnter={() => onPrefetch(receipt.receipt_id)}
      onMouseLeave={() => onPrefetchLeave(receipt.receipt_id)}
      className={`relative block w-full px-5 py-4 text-left transition-colors ${
        selected ? "bg-slate-100/70" : "bg-white hover:bg-slate-100/60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-3 left-[11px] top-3 rounded-full ${
          selected ? "w-[3px] bg-primary" : "w-px bg-slate-200"
        }`}
      />
      <div className="flex items-start justify-between gap-4 pl-2">
        <div className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-slate-950">
            {receipt.student_name}
          </span>
          <span className="mt-1 block truncate text-[13px] text-slate-600">
            {getPaidReceiptClassSummary(receipt)}
            {receipt.period ? ` · ${formatPeriod(receipt.period)}` : ""}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[15px] font-semibold tabular-nums text-slate-950">
            {formatCurrency(receipt.net_amount)}
          </span>
          <span
            className={`mt-1 block text-xs font-medium ${getStateTextClass(state.tone)}`}
          >
            {state.label}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 pl-2 text-[12px] text-slate-500">
        <span className="tabular-nums">
          {formatDate(receipt.paid_date)} ·{" "}
          {getPaymentMethodLabel(receipt.payment_method)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </div>
      <span className="mt-2 block truncate pl-2 text-xs text-slate-500">
        {getPaymentOriginLabel(receipt.payment_origin)} · {getPaidReceiptActor(receipt)}
      </span>
    </button>
  );
}

function LoadMore({
  hasNextPage,
  isFetching,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}) {
  if (!hasNextPage) {
    return null;
  }

  return (
    <div className="flex justify-center border-t border-slate-100 bg-white p-3">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={isFetching}
        className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isFetching ? <LoadingLabel label="Đang tải thêm" /> : "Xem phiếu cũ hơn"}
      </button>
    </div>
  );
}

function getStateTextClass(tone: "emerald" | "amber" | "rose" | "gray") {
  const classes = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    gray: "text-slate-500",
  };
  return classes[tone];
}

function formatPaidTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
