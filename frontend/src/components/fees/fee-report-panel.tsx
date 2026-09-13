"use client";

import type {
  ClassFeeSummary,
  FeeSummaryMetrics,
  FeeTab,
  UnpaidStage,
} from "@/lib/fees/types";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";

type FeeReportPanelProps = {
  activeClassId: string;
  activeTab: FeeTab;
  classItems: ClassFeeSummary[];
  onChangeClass: (classId: string) => void;
  onChangeTab: (tab: FeeTab) => void;
  onChangeUnpaidStage: (stage: UnpaidStage) => void;
  embedded?: boolean;
  scopeLabel: string;
  summary: FeeSummaryMetrics;
  unpaidStage: UnpaidStage;
  outstandingView?: boolean;
};

/**
 * A quiet ledger header: one financial summary, one status filter and one
 * class filter. It deliberately avoids dashboard-only decoration so the fee
 * list remains the primary working surface.
 */
export function FeeReportPanel({
  activeClassId,
  activeTab,
  classItems,
  onChangeClass,
  onChangeTab,
  onChangeUnpaidStage,
  embedded = false,
  scopeLabel,
  summary,
  unpaidStage,
  outstandingView = false,
}: FeeReportPanelProps) {
  const collectedPercent =
    summary.total > 0
      ? Math.min(100, Math.max(0, (summary.netCollected / summary.total) * 100))
      : 0;
  const roundedCollectedPercent = Math.round(collectedPercent);
  const hasCurrentPeriodFees = summary.total > 0;

  return (
    <section
      aria-label="Tổng quan và bộ lọc khoản thu"
      className={cn(
        "shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3",
        embedded && "xl:rounded-b-none",
      )}
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2 md:gap-x-5 md:gap-y-3 lg:grid-cols-12 lg:items-center lg:gap-0">
        <div className="min-w-0 md:col-span-1 lg:col-span-4 lg:pr-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="table-heading-text text-gray-500">
              {outstandingView ? "Khoản thu kỳ trước trễ hạn" : "Khoản thu kỳ hiện tại"}
            </p>
            <span className="truncate text-[12px] font-medium text-gray-500">
              {scopeLabel}
            </span>
          </div>

          {outstandingView ? (
            <>
              <p className="metric-money mt-1 text-[22px] leading-7 text-gray-950">
                {formatCurrency(summary.outstanding)}
              </p>
              <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-500">
                {summary.recordCount > 0
                  ? `${summary.recordCount} khoản chưa hoàn tất`
                  : "Không còn khoản chờ thu"}
              </p>
            </>
          ) : hasCurrentPeriodFees ? (
            <>
              <p className="metric-money mt-1 min-w-0 text-[22px] leading-7 text-gray-950">
                {formatCurrency(summary.netCollected)}
                <span className="mx-1.5 text-base font-medium text-gray-300">/</span>
                <span className="text-base font-medium text-gray-600">
                  {formatCurrency(summary.total)}
                </span>
              </p>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[13px] leading-5">
                <span className="text-gray-500">
                  Chưa thu {formatCurrency(summary.outstanding)}
                  {summary.refunded > 0
                    ? ` · Đã hoàn ${formatCurrency(summary.refunded)}`
                    : ""}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-primary">
                  {roundedCollectedPercent >= 100 ? "Đã thu đủ" : `${roundedCollectedPercent}%`}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Tỷ lệ học phí đã thu trong kỳ"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={roundedCollectedPercent}
                className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100"
              >
                <span
                  aria-hidden="true"
                  className="block h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${collectedPercent}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-base font-semibold text-gray-900">Chưa phát sinh</p>
              <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-500">
                Chưa có khoản học phí trong kỳ này.
              </p>
            </>
          )}
        </div>

        <div
          role="group"
          aria-label="Lọc theo trạng thái khoản thu"
          className={cn(
            "order-3 grid min-w-0 gap-1 rounded-lg bg-gray-50 p-1 md:col-span-2 lg:order-none lg:col-span-5 lg:mx-5",
            outstandingView ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          <FeeStatusFilter
            label="Chưa báo"
            value={summary.unnotified}
            tone="rose"
            selected={activeTab === "unpaid" && unpaidStage === "unnotified"}
            onClick={() => {
              onChangeTab("unpaid");
              onChangeUnpaidStage("unnotified");
            }}
          />
          <FeeStatusFilter
            label="Đã báo"
            value={summary.notified}
            tone="amber"
            selected={activeTab === "unpaid" && unpaidStage === "notified"}
            onClick={() => {
              onChangeTab("unpaid");
              onChangeUnpaidStage("notified");
            }}
          />
          {!outstandingView ? (
            <FeeStatusFilter
              label="Đã nộp"
              value={summary.paid}
              tone="emerald"
              selected={activeTab === "paid"}
              onClick={() => onChangeTab("paid")}
            />
          ) : null}
        </div>

        <label className="block min-w-0 md:col-span-1 lg:col-span-3 lg:border-l lg:border-gray-200 lg:pl-5">
          <span className="form-label-text mb-1.5 block select-none text-gray-700">
            Lớp học
          </span>
          <select
            aria-label="Lọc khoản thu theo lớp"
            value={activeClassId}
            onChange={(event) => onChangeClass(event.target.value)}
            className={cn(formTextControlClassName, "h-11 md:h-8")}
          >
            <option value="">Tất cả lớp ({classItems.length})</option>
            {classItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.unpaidStudentCount} chưa nộp
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function FeeStatusFilter({
  label,
  onClick,
  selected,
  tone,
  value,
}: {
  label: string;
  onClick: () => void;
  selected: boolean;
  tone: "rose" | "amber" | "emerald";
  value: number;
}) {
  const dotClass = {
    rose: "bg-rose-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value} khoản`}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:min-h-9",
        selected
          ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
          : "font-medium text-gray-600 hover:bg-white hover:text-gray-900",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 text-[13px] font-semibold tabular-nums",
          selected ? "text-primary" : "text-gray-700",
        )}
      >
        {value}
      </span>
    </button>
  );
}
