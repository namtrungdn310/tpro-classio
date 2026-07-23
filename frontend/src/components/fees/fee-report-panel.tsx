"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  ClassFeeSummary,
  FeeSummaryMetrics,
  FeeTab,
  UnpaidStage,
} from "@/lib/fees/types";
import { getClassGroupInfo } from "@/lib/utils/class-groups";
import { formatCurrency } from "@/lib/utils/format";
import {
  DEFAULT_FEE_CLASS_CARDS_PER_ROW,
  FEE_CLASS_FILTER_ROWS,
  getFeeClassCardsPerRow,
  getFeeClassMinimumCardWidth,
  getFeeClassPageColumnCount,
  getFeeClassPageCount,
  getFeeClassPageIndex,
  getFeeClassPageItems,
} from "@/lib/fees/class-filter-pagination";

type FeeReportPanelProps = {
  activeClassId: string;
  activeTab: FeeTab;
  classItems: ClassFeeSummary[];
  onChangeClass: (classId: string) => void;
  onChangeTab: (tab: FeeTab) => void;
  onChangeUnpaidStage: (stage: UnpaidStage) => void;
  summary: FeeSummaryMetrics;
  unpaidStage: UnpaidStage;
};

type FeeMetricProps = {
  hint: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  tone: "slate" | "rose" | "amber" | "sky" | "emerald";
  value: React.ReactNode;
};

export function FeeReportPanel({
  activeClassId,
  activeTab,
  classItems,
  onChangeClass,
  onChangeTab,
  onChangeUnpaidStage,
  summary,
  unpaidStage,
}: FeeReportPanelProps) {
  const classGridId = useId();
  const classGridRef = useRef<HTMLDivElement>(null);
  const [cardsPerRow, setCardsPerRow] = useState(DEFAULT_FEE_CLASS_CARDS_PER_ROW);
  const [pageIndex, setPageIndex] = useState(0);
  const minimumClassCardWidth = useMemo(
    () => getFeeClassMinimumCardWidth(classItems.map((item) => item.name)),
    [classItems],
  );
  const pageCount = getFeeClassPageCount(classItems.length, cardsPerRow);
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageItems = useMemo(
    () => getFeeClassPageItems(classItems, safePageIndex, cardsPerRow),
    [cardsPerRow, classItems, safePageIndex],
  );
  const pageColumnCount = getFeeClassPageColumnCount(pageItems.length, cardsPerRow);

  useEffect(() => {
    const grid = classGridRef.current;
    if (!grid) return;

    const updateCardsPerRow = () => {
      setCardsPerRow((current) => {
        const next = getFeeClassCardsPerRow(
          grid.getBoundingClientRect().width,
          minimumClassCardWidth,
        );
        return current === next ? current : next;
      });
    };

    updateCardsPerRow();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateCardsPerRow);
      return () => window.removeEventListener("resize", updateCardsPerRow);
    }

    const observer = new ResizeObserver(updateCardsPerRow);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [minimumClassCardWidth]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (!activeClassId) return;
    const activeItemIndex = classItems.findIndex((item) => item.id === activeClassId);
    if (activeItemIndex >= 0) {
      setPageIndex(getFeeClassPageIndex(activeItemIndex, cardsPerRow));
    }
  }, [activeClassId, cardsPerRow, classItems]);

  return (
    <aside className="grid select-none items-stretch gap-3 xl:grid-cols-[340px_1fr] xl:gap-4">
      <section className="flex flex-col gap-2 overflow-visible">
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-md border border-gray-200 bg-slate-50/30 px-4 py-3 shadow-sm">
          <span
            className="absolute inset-y-0 left-0 w-1 bg-gray-900"
            aria-hidden="true"
          />
          <div className="flex items-center justify-between gap-3 pl-1">
            <p className="table-heading-text whitespace-nowrap text-gray-600">
              Thực thu
            </p>
            <span className="shrink-0 rounded-md bg-gray-200/60 px-2 py-1 text-[11px] font-semibold text-gray-800">
              {summary.paid}/{summary.recordCount} khoản
            </span>
          </div>
          <div className="flex flex-1 items-center pl-1">
            <p className="metric-value metric-money whitespace-nowrap text-[20px] leading-tight text-gray-950 xl:text-[21px]">
              {formatCurrency(summary.netCollected)} /{" "}
              {formatCurrency(summary.total)}
            </p>
          </div>
          <div className="pl-1 text-xs font-medium leading-4 text-gray-500">
            <span className="block">
              Đã nhận {formatCurrency(summary.grossCollected)} · Đã hoàn{" "}
              {formatCurrency(summary.refunded)}
            </span>
            <span className="block">
              Còn phải thu {formatCurrency(summary.outstanding)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-1">
          <FeeMetric
            label="Chưa báo"
            value={summary.unnotified}
            hint="khoản"
            tone="rose"
            selected={activeTab === "unpaid" && unpaidStage === "unnotified"}
            onClick={() => {
              onChangeTab("unpaid");
              onChangeUnpaidStage("unnotified");
            }}
          />
          <FeeMetric
            label="Đã báo"
            value={summary.notified}
            hint="khoản"
            tone="amber"
            selected={activeTab === "unpaid" && unpaidStage === "notified"}
            onClick={() => {
              onChangeTab("unpaid");
              onChangeUnpaidStage("notified");
            }}
          />
          <FeeMetric
            label="Đã nộp"
            value={summary.paid}
            hint="khoản"
            tone="emerald"
            selected={activeTab === "paid"}
            onClick={() => onChangeTab("paid")}
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-md border border-gray-200">
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/50 px-3">
          <p className="text-sm font-semibold text-gray-900">Theo lớp</p>
          <div className="flex items-center gap-1.5">
            <span className="min-w-9 text-center text-[11px] font-medium tabular-nums text-gray-500" aria-live="polite">
              {safePageIndex + 1}/{pageCount}
            </span>
            <button
              type="button"
              aria-label="Xem các lớp ở trang trước"
              aria-controls={classGridId}
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-600"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Xem các lớp ở trang sau"
              aria-controls={classGridId}
              disabled={safePageIndex >= pageCount - 1}
              onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-600"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          ref={classGridRef}
          id={classGridId}
          role="region"
          aria-label={`Bộ lọc học phí theo lớp, trang ${safePageIndex + 1} trên ${pageCount}`}
          className="grid h-[172px] grid-flow-col content-stretch gap-1.5 overflow-hidden p-2"
          style={{
            gridTemplateColumns: `repeat(${pageColumnCount}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${FEE_CLASS_FILTER_ROWS}, minmax(0, 1fr))`,
          }}
        >
          {classItems.length === 0 ? (
            <p className="text-sm text-gray-500">Chưa có dữ liệu.</p>
          ) : null}
          {pageItems.map((item) => {
            const selected = activeClassId === item.id;
            const color = getClassGroupInfo(item.name).color;

            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                aria-label={`${item.name}: ${item.unpaidStudentCount} học viên chưa nộp, tổng phải thu ${formatCurrency(item.totalAmount)}`}
                onClick={() => onChangeClass(selected ? "" : item.id)}
                title={item.name}
                className={`group flex min-w-0 flex-col justify-center overflow-hidden rounded border px-2 py-1.5 text-left transition ${
                  selected
                    ? "border-gray-400 bg-gray-50 shadow-sm"
                    : "border-gray-100 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color.border }}
                  />
                  <span className="min-w-0 whitespace-nowrap text-xs font-semibold leading-4 text-gray-900">
                    {item.name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 pl-3.5 text-[11px] text-gray-500">
                  <span title="Chưa nộp / Tổng số">
                    {item.unpaidStudentCount}/
                    {item.paidStudentCount + item.unpaidStudentCount}
                  </span>
                  <span
                    className="whitespace-nowrap font-medium text-gray-900"
                    title="Tổng phải thu trong kỳ"
                  >
                    {formatCurrency(item.totalAmount)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function FeeMetric({
  hint,
  label,
  onClick,
  selected,
  className,
  tone,
  value,
}: FeeMetricProps) {
  const toneClass = {
    slate: "border-slate-200 bg-slate-50 text-slate-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    sky: "border-sky-200 bg-sky-50 text-sky-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  }[tone];

  const selectedRing = selected
    ? {
        rose: "!border-rose-400 shadow-sm",
        amber: "!border-amber-400 shadow-sm",
        emerald: "!border-emerald-400 shadow-sm",
        slate: "!border-slate-400 shadow-sm",
        sky: "!border-sky-400 shadow-sm",
      }[tone]
    : "";
  const clickable = onClick
    ? "cursor-pointer hover:shadow-sm transition-shadow"
    : "";

  const content = (
    <>
      <p className="text-[10px] font-bold uppercase leading-tight opacity-70">
        {label}
      </p>
      <p className="mt-0.5 flex-1 text-lg font-semibold leading-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] font-medium leading-tight opacity-60">
          {hint}
        </p>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`flex flex-col justify-center rounded-md border px-2.5 py-1.5 text-left ${toneClass} ${selectedRing} ${clickable} ${className || ""}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`flex flex-col justify-center rounded-md border px-2.5 py-1.5 ${toneClass} ${className || ""}`}
    >
      {content}
    </div>
  );
}
