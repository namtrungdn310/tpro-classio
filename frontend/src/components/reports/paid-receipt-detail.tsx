"use client";

import { useEffect, useRef } from "react";
import { RiReceiptLine as ReceiptText, RiCloseLine as X } from "react-icons/ri";
import { DataSectionError } from "@/components/ui/data-section-state";
import type {
  FeePaidReceiptDetail,
  FeePaidReceiptRefundState,
  FeePaidReceiptTimelineItem,
} from "@/lib/types";
import {
  getPaidReceiptActor,
  getPaidReceiptCode,
  getPaymentMethodLabel,
  PAID_RECEIPT_REFUND_META,
  PAID_RECEIPT_TIMELINE_META,
} from "@/lib/reports/paid-report-view-model";
import {
  formatCurrency,
  formatDateTime,
  formatPeriod,
} from "@/lib/utils/format";

type PaidReceiptDetailProps = {
  detail: FeePaidReceiptDetail | null;
  isError: boolean;
  isLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
  selectedId: string | null;
};

export function PaidReceiptDetail({
  detail,
  isError,
  isLoading,
  onClose,
  onRetry,
  selectedId,
}: PaidReceiptDetailProps) {
  const mobilePanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const returnFocus = document.activeElement as HTMLElement | null;
    const isModal = window.matchMedia("(max-width: 1535px)").matches;
    const previousBodyOverflow = document.body.style.overflow;
    if (isModal) {
      document.body.style.overflow = "hidden";
    }
    const timeoutId = globalThis.setTimeout(() => {
      if (isModal) {
        mobilePanelRef.current?.focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      globalThis.clearTimeout(timeoutId);
      document.removeEventListener("keydown", handleKeyDown);
      if (isModal) {
        document.body.style.overflow = previousBodyOverflow;
      }
      returnFocus?.focus();
    };
  }, [onClose, selectedId]);

  return (
    <>
      <aside className="hidden min-h-0 border-l border-slate-200 bg-white 2xl:flex 2xl:flex-col">
        <DetailState
          detail={detail}
          isError={isError}
          isLoading={isLoading}
          onClose={onClose}
          onRetry={onRetry}
          selectedId={selectedId}
        />
      </aside>

      {selectedId ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 2xl:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <aside
            ref={mobilePanelRef}
            tabIndex={-1}
            aria-label="Chi tiết phiếu thu"
            className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl outline-none motion-safe:transition-transform motion-safe:duration-200"
          >
            <DetailState
              detail={detail}
              isError={isError}
              isLoading={isLoading}
              onClose={onClose}
              onRetry={onRetry}
              selectedId={selectedId}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function DetailState({
  detail,
  isError,
  isLoading,
  onClose,
  onRetry,
  selectedId,
}: PaidReceiptDetailProps) {
  if (!selectedId) {
    return (
      <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <ReceiptText className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-[14px] font-semibold text-slate-800">
          Chọn một phiếu thu
        </p>
        <p className="mt-1 max-w-[250px] text-[12px] leading-5 text-slate-500">
          Xem phân bổ theo lớp và toàn bộ diễn biến thu, hoàn phí.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <PaidReceiptDetailSkeleton />;
  }

  if (isError || !detail) {
    return (
      <div className="flex h-full min-h-80 flex-col p-5">
        <div className="flex justify-end">
          <CloseButton onClose={onClose} />
        </div>
        <DataSectionError
          className="mt-4 min-h-0 flex-1"
          title="Không tải được phiếu thu"
          description="Danh sách vẫn có thể sử dụng. Vui lòng thử tải lại riêng phần chi tiết."
          onRetry={onRetry}
        />
      </div>
    );
  }

  return <PaidReceiptDetailContent detail={detail} onClose={onClose} />;
}

function PaidReceiptDetailContent({
  detail,
  onClose,
}: {
  detail: FeePaidReceiptDetail;
  onClose: () => void;
}) {
  const state = PAID_RECEIPT_REFUND_META[detail.refund_state];

  return (
    <>
      <header className="shrink-0 border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-ui text-[16px] font-semibold text-slate-950">
                Phiếu thu
              </p>
              <ReceiptState state={detail.refund_state} />
            </div>
            <p className="mt-1 text-[11px] font-medium tabular-nums tracking-[0.04em] text-slate-400">
              {getPaidReceiptCode(detail.payment_operation_id)}
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
      </header>

      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section className="border-b border-slate-200 px-5 py-4">
          <p className="truncate text-[17px] font-semibold text-slate-950">
            {detail.student_name}
          </p>
          <p className="mt-1 text-[13px] text-slate-500">
            {detail.period ? formatPeriod(detail.period) : "Nhiều kỳ học phí"} ·{" "}
            <time dateTime={detail.paid_at}>
              {formatDateTime(detail.paid_at)}
            </time>
          </p>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3.5">
            <div className="flex items-end justify-between gap-4">
              <p className="text-[12px] font-medium text-slate-500">
                Thực thu
              </p>
              <p className="metric-money text-[22px] font-semibold leading-7 text-slate-950">
                {formatCurrency(detail.net_amount)}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-[12px]">
              <MoneyFact label="Đã nhận" value={detail.gross_amount} />
              <MoneyFact
                label="Đã hoàn"
                value={detail.refunded_amount}
                tone="rose"
              />
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailFact
              label="Hình thức"
              value={getPaymentMethodLabel(detail.payment_method)}
            />
            <DetailFact
              label="Người ghi nhận"
              value={getPaidReceiptActor(detail)}
            />
          </dl>

          {state.tone === "gray" ? (
            <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
              Phiếu này đã được hoàn tác và không còn được cộng vào thực thu.
            </p>
          ) : null}
        </section>

        <section className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-[13px] font-semibold text-slate-900">
            Phân bổ theo lớp
          </h3>
          <div className="mt-2.5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {detail.allocations.map((item) => (
              <div
                key={`${item.fee_record_id ?? item.enrollment_id ?? item.class_name}-${item.period}`}
                className="px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-900">
                      {item.class_name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatPeriod(item.period)}
                    </p>
                  </div>
                  <p className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-950">
                    {formatCurrency(item.net_amount)}
                  </p>
                </div>
                {item.refunded_amount > 0 ? (
                  <p className="mt-1 text-right text-[11px] tabular-nums text-rose-700">
                    Đã nhận {formatCurrency(item.gross_amount)} · hoàn{" "}
                    {formatCurrency(item.refunded_amount)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="px-5 py-4">
          <h3 className="text-[13px] font-semibold text-slate-900">
            Diễn biến phiếu thu
          </h3>
          <ol className="relative mt-3 space-y-4">
            <span
              aria-hidden="true"
              className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200"
            />
            {detail.timeline.map((entry) => (
              <TimelineEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function TimelineEntry({ entry }: { entry: FeePaidReceiptTimelineItem }) {
  const meta = PAID_RECEIPT_TIMELINE_META[entry.event];

  return (
    <li className="relative grid grid-cols-[12px_minmax(0,1fr)] gap-3">
      <span
        aria-hidden="true"
        className={`relative z-[1] mt-1.5 h-[11px] w-[11px] rounded-full border-2 border-white shadow-[0_0_0_1px_currentColor] ${getTimelineDotClass(meta.tone)}`}
      />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800">
              {meta.label}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {entry.actor_name ||
                entry.actor_username ||
                "Dữ liệu lịch sử"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={`text-[12px] font-semibold tabular-nums ${entry.amount_delta < 0 ? "text-rose-700" : "text-slate-800"}`}
            >
              {formatTimelineAmount(entry.amount_delta)}
            </p>
            <time
              dateTime={entry.occurred_at}
              className="mt-0.5 block text-[10px] tabular-nums text-slate-400"
            >
              {formatDateTime(entry.occurred_at)}
            </time>
          </div>
        </div>
        {entry.reason ? (
          <p className="mt-1.5 text-[12px] leading-5 text-slate-600">
            {entry.reason}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function MoneyFact({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "rose";
  value: number;
}) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p
        className={`mt-0.5 font-semibold tabular-nums ${tone === "rose" ? "text-rose-700" : "text-slate-800"}`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold text-slate-800">
        {value}
      </dd>
    </div>
  );
}

function ReceiptState({ state }: { state: FeePaidReceiptRefundState }) {
  const meta = PAID_RECEIPT_REFUND_META[state];
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ${getStateBadgeClass(meta.tone)}`}
    >
      {meta.label}
    </span>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Đóng chi tiết phiếu thu"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function PaidReceiptDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải chi tiết phiếu thu"
      className="h-full animate-pulse p-5"
    >
      <div className="h-5 w-36 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-24 rounded bg-slate-100" />
      <div className="mt-6 h-5 w-48 rounded bg-slate-200" />
      <div className="mt-3 h-28 rounded-xl bg-slate-100" />
      <div className="mt-6 h-4 w-32 rounded bg-slate-200" />
      <div className="mt-3 space-y-2">
        <div className="h-14 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function getStateBadgeClass(
  tone: "emerald" | "amber" | "rose" | "gray",
) {
  const classes = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    gray: "bg-slate-100 text-slate-600",
  };
  return classes[tone];
}

function getTimelineDotClass(
  tone: "emerald" | "rose" | "sky" | "gray",
) {
  const classes = {
    emerald: "bg-emerald-500 text-emerald-500",
    rose: "bg-rose-500 text-rose-500",
    sky: "bg-sky-500 text-sky-500",
    gray: "bg-slate-400 text-slate-400",
  };
  return classes[tone];
}

function formatTimelineAmount(value: number) {
  if (value === 0) {
    return formatCurrency(0);
  }
  return `${value > 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
}
