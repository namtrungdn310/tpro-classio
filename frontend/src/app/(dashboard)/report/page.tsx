"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RiReceiptLine as ReceiptText } from "react-icons/ri";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { useToast } from "@/components/providers/toast-provider";
import { PaidReceiptDetail } from "@/components/reports/paid-receipt-detail";
import { PaidReceiptTable } from "@/components/reports/paid-receipt-table";
import { PaidReportSummaryBand } from "@/components/reports/paid-report-summary";
import { FeeOperationPanel } from "@/components/reports/fee-operation-panel";
import { PaymentReconciliationPanel } from "@/components/reports/payment-reconciliation-panel";
import { ReportPageSkeleton } from "@/components/reports/report-skeleton";
import {
  DataSectionEmpty,
  DataSectionError,
} from "@/components/ui/data-section-state";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import { getFeePeriods } from "@/lib/api/fees";
import {
  getFeePaidReceipt,
  getFeePaidReceipts,
  type FeeOperationFilters,
  type FeePaidReceiptFilters,
} from "@/lib/api/reports";
import { useAuth } from "@/lib/hooks/useAuth";
import { exportFeeOperations, exportPaidReceipts } from "@/lib/reports/export";
import {
  EMPTY_PAID_REPORT_SUMMARY,
} from "@/lib/reports/paid-report-view-model";
import type {
  FeePaidReceiptRefundState,
  FeeOperationAction,
  FeePaymentMethod,
} from "@/lib/types";
import { formatPeriod } from "@/lib/utils/format";

const RANGE_OPTIONS = [
  { value: "", label: "Toàn bộ" },
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "90d", label: "90 ngày" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "bank_transfer", label: "Chuyển khoản" },
  { value: "cash", label: "Tiền mặt" },
];

const REFUND_STATE_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "NONE", label: "Chưa hoàn" },
  { value: "PARTIAL", label: "Hoàn một phần" },
  { value: "FULL", label: "Hoàn hết" },
  { value: "REVERSED", label: "Đã hoàn tác" },
];

const PAYMENT_ORIGIN_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "pay2s", label: "Pay2S tự động" },
  { value: "manual", label: "Ghi nhận thủ công" },
  { value: "manual_early", label: "Thu sớm thủ công" },
];

const OPERATION_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "payment", label: "Ghi nhận học phí" },
  { value: "payment_reversal", label: "Hoàn tác ghi nhận" },
  { value: "refund", label: "Hoàn học phí" },
  { value: "refund_reversal", label: "Hoàn tác hoàn phí" },
  { value: "notify", label: "Nhắc học phí" },
  { value: "unnotify", label: "Hủy đã nhắc" },
  { value: "sync", label: "Đồng bộ" },
];

type ReportView = "receipts" | "operations" | "reconciliation";

const DETAIL_STALE_MS = 2 * 60 * 1000;

export default function ReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const notify = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const requestedView = searchParams.get("view");
  const view: ReportView = requestedView === "operations" || requestedView === "reconciliation" ? requestedView : "receipts";
  const debouncedSearch = useDebouncedValue(search, 250);
  const [period, setPeriod] = useState("");
  const [range, setRange] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentOrigin, setPaymentOrigin] = useState("");
  const [operationAction, setOperationAction] = useState("");
  const [refundState, setRefundState] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const setView = useCallback((nextView: ReportView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === "receipts") params.delete("view");
    else params.set("view", nextView);
    setSelectedId(null);
    const query = params.toString();
    router.replace(query ? `/report?${query}` : "/report", { scroll: false });
  }, [router, searchParams]);
  const dates = useMemo(() => getDateRange(range), [range]);

  const filters = useMemo<FeePaidReceiptFilters>(
    () => ({
      period,
      q: debouncedSearch,
      date_from: dates.from,
      date_to: dates.to,
      payment_method: paymentMethod as FeePaymentMethod | "",
      payment_origin: paymentOrigin as FeePaidReceiptFilters["payment_origin"],
      refund_state: refundState as FeePaidReceiptRefundState | "",
      limit: 30,
    }),
    [
      dates.from,
      dates.to,
      debouncedSearch,
      paymentMethod,
      paymentOrigin,
      period,
      refundState,
    ],
  );

  const operationFilters = useMemo<FeeOperationFilters>(
    () => ({
      period,
      q: debouncedSearch,
      date_from: dates.from,
      date_to: dates.to,
      action: operationAction as FeeOperationAction | "",
      limit: 30,
    }),
    [dates.from, dates.to, debouncedSearch, operationAction, period],
  );

  const periodsQuery = useQuery({
    queryKey: ["fee-periods"],
    queryFn: getFeePeriods,
    enabled: Boolean(user) && view !== "reconciliation",
    staleTime: 5 * 60 * 1000,
  });

  const receiptsQuery = useInfiniteQuery({
    queryKey: ["reports", "fee-paid", filters],
    queryFn: ({ pageParam, signal }) =>
      getFeePaidReceipts({ ...filters, cursor: pageParam }, signal),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user) && view === "receipts",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const receipts = useMemo(() => {
    const byId = new Map(
      (receiptsQuery.data?.pages ?? [])
        .flatMap((page) => page.receipts)
        .map((receipt) => [receipt.receipt_id, receipt] as const),
    );
    return [...byId.values()];
  }, [receiptsQuery.data]);

  const summary =
    receiptsQuery.data?.pages[0]?.summary ?? EMPTY_PAID_REPORT_SUMMARY;

  useEffect(() => {
    if (
      selectedId &&
      receiptsQuery.data &&
      !receipts.some((receipt) => receipt.receipt_id === selectedId)
    ) {
      setSelectedId(null);
    }
  }, [receipts, receiptsQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["reports", "fee-paid-detail", selectedId],
    queryFn: ({ signal }) => getFeePaidReceipt(selectedId!, signal),
    enabled: Boolean(selectedId) && view === "receipts",
    staleTime: 2 * 60 * 1000,
  });

  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePrefetch = useCallback(
    (receiptId: string) => {
      // Chỉ prefetch sau khi hover ổn định ~120ms; rời chuột sẽ hủy và không
      // gửi request dự phòng khi detail đã có trong cache.
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
      }
      prefetchTimerRef.current = setTimeout(() => {
        prefetchTimerRef.current = null;
        const state = queryClient.getQueryState([
          "reports",
          "fee-paid-detail",
          receiptId,
        ]);
        const isFresh =
          typeof state?.dataUpdatedAt === "number" &&
          Date.now() - state.dataUpdatedAt < DETAIL_STALE_MS;
        if (isFresh) {
          return;
        }
        void queryClient.prefetchQuery({
          queryKey: ["reports", "fee-paid-detail", receiptId],
          queryFn: ({ signal }) => getFeePaidReceipt(receiptId, signal),
          staleTime: DETAIL_STALE_MS,
        });
      }, 120);
    },
    [queryClient],
  );

  const handlePrefetchLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
      }
    },
    [],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setPeriod("");
    setRange("");
    setPaymentMethod("");
    setPaymentOrigin("");
    setOperationAction("");
    setRefundState("");
    setSelectedId(null);
  }, []);

  const periodOptions = [
    { value: "", label: "Tất cả" },
    ...(periodsQuery.data?.periods ?? []).map((value) => ({
      value,
      label: formatPeriod(value),
    })),
  ];
  const hasActiveFilters = view === "receipts"
    ? Boolean(search || period || range || paymentMethod || paymentOrigin || refundState)
    : view === "operations"
      ? Boolean(search || period || range || operationAction)
      : false;
  const isInitialLoading = receiptsQuery.isPending && !receiptsQuery.data;
  const isInitialError = receiptsQuery.isError && !receiptsQuery.data;
  const exportFilterLabel = useMemo(() => {
    const labels = [
      period ? formatPeriod(period) : "Tất cả kỳ",
      RANGE_OPTIONS.find((option) => option.value === range)?.label,
    ];
    return labels.filter(Boolean).join(" · ");
  }, [period, range]);

  async function handleExport() {
    if (isExporting || view === "reconciliation") return;
    setIsExporting(true);
    try {
      const count = view === "receipts"
        ? await exportPaidReceipts(filters, exportFilterLabel)
        : await exportFeeOperations(operationFilters, exportFilterLabel);
      notify.success(`Đã xuất danh sách ${count} ${view === "receipts" ? "phiếu thu" : "hoạt động"} ra file Excel.`);
    } catch {
      notify.error("Không thể xuất báo cáo. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  const headerFilters = view === "receipts"
    ? [
        { label: "Kỳ học phí", value: period, onChange: setPeriod, options: periodOptions, defaultValue: "" },
        { label: "Ngày nộp", value: range, onChange: setRange, options: RANGE_OPTIONS, defaultValue: "" },
        { label: "Hình thức", value: paymentMethod, onChange: setPaymentMethod, options: PAYMENT_METHOD_OPTIONS, defaultValue: "" },
        { label: "Nguồn ghi nhận", value: paymentOrigin, onChange: setPaymentOrigin, options: PAYMENT_ORIGIN_OPTIONS, defaultValue: "" },
        { label: "Hoàn phí", value: refundState, onChange: setRefundState, options: REFUND_STATE_OPTIONS, defaultValue: "" },
      ]
    : [
        { label: "Kỳ học phí", value: period, onChange: setPeriod, options: periodOptions, defaultValue: "" },
        { label: "Thời gian", value: range, onChange: setRange, options: RANGE_OPTIONS, defaultValue: "" },
        { label: "Hoạt động", value: operationAction, onChange: setOperationAction, options: OPERATION_OPTIONS, defaultValue: "" },
      ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {view !== "reconciliation" ? (
        <HeaderControlsPortal>
          <div className="flex min-w-0 items-center gap-3">
            <HeaderFilterControls
              searchPlaceholder={view === "receipts" ? "Tìm học viên, lớp, mã phiếu..." : "Tìm học viên, lớp..."}
              searchValue={search}
              onSearchChange={(value) => setSearch(value.slice(0, 100))}
              onClear={clearFilters}
              filters={headerFilters}
            />
            <ExcelExportButton
              disabled={view === "receipts" ? isInitialLoading : false}
              isExporting={isExporting}
              onClick={() => void handleExport()}
            />
          </div>
        </HeaderControlsPortal>
      ) : null}

      <div
        role="tablist"
        aria-label="Nội dung báo cáo học phí"
        className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-white p-1.5"
      >
        <ReportTab label="Sổ thu" active={view === "receipts"} onClick={() => setView("receipts")} />
        <ReportTab label="Nhật ký học phí" active={view === "operations"} onClick={() => setView("operations")} />
        <ReportTab label="Giao dịch cần kiểm tra" active={view === "reconciliation"} onClick={() => setView("reconciliation")} />
      </div>

      <section className="flex h-full min-h-[calc(100dvh-9.5rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white md:min-h-0">
        {view === "receipts" ? (
          isInitialLoading ? <ReportPageSkeleton /> : isInitialError ? (
            <DataSectionError
              className="min-h-0 flex-1 rounded-none border-0"
              title="Không tải được sổ thu học phí"
              description="Dữ liệu tài chính vẫn được giữ nguyên. Vui lòng kiểm tra kết nối và thử lại."
              isRetrying={receiptsQuery.isFetching}
              onRetry={() => void receiptsQuery.refetch()}
            />
          ) : (
            <>
              <PaidReportSummaryBand
                summary={summary}
                isRefreshing={receiptsQuery.isFetching && !receiptsQuery.isFetchingNextPage && !isInitialLoading}
              />
              {receiptsQuery.isError && receiptsQuery.data ? (
                <div role="alert" className="flex shrink-0 items-center justify-between gap-4 border-b border-rose-100 bg-rose-50/70 px-5 py-2 text-xs text-rose-800">
                  <span>Chưa thể cập nhật dữ liệu mới nhất. Danh sách gần nhất vẫn được giữ.</span>
                  <button type="button" onClick={() => void receiptsQuery.refetch()} className="shrink-0 font-semibold underline underline-offset-2">Thử lại</button>
                </div>
              ) : null}
              <div className="grid min-h-0 flex-1 2xl:grid-cols-[minmax(0,1fr)_390px]">
                <div className="flex min-h-0 flex-col overflow-hidden">
                  {receipts.length === 0 ? (
                    <DataSectionEmpty
                      className="min-h-0 flex-1 rounded-none border-0 bg-white"
                      icon={ReceiptText}
                      title={hasActiveFilters ? "Không có phiếu thu phù hợp" : "Chưa có khoản học phí đã nộp"}
                      description={hasActiveFilters ? "Thử thay đổi từ khóa hoặc bộ lọc để xem các phiếu thu khác." : "Phiếu thu sẽ xuất hiện tại đây sau khi học phí được ghi nhận."}
                      actionLabel={hasActiveFilters ? "Xóa bộ lọc" : undefined}
                      onAction={hasActiveFilters ? clearFilters : undefined}
                    />
                  ) : (
                    <PaidReceiptTable
                      receipts={receipts}
                      selectedId={selectedId}
                      hasNextPage={Boolean(receiptsQuery.hasNextPage)}
                      isFetchingNextPage={receiptsQuery.isFetchingNextPage}
                      onLoadMore={() => void receiptsQuery.fetchNextPage()}
                      onSelect={setSelectedId}
                      onPrefetch={handlePrefetch}
                      onPrefetchLeave={handlePrefetchLeave}
                    />
                  )}
                </div>
                <PaidReceiptDetail
                  selectedId={selectedId}
                  detail={detailQuery.data ?? null}
                  isLoading={detailQuery.isPending && Boolean(selectedId)}
                  isError={detailQuery.isError}
                  onClose={handleCloseDetail}
                  onRetry={() => void detailQuery.refetch()}
                />
              </div>
            </>
          )
        ) : view === "operations" ? (
          <FeeOperationPanel filters={operationFilters} hasActiveFilters={hasActiveFilters} onClearFilters={clearFilters} />
        ) : (
          <PaymentReconciliationPanel />
        )}
      </section>
    </div>
  );
}

function ReportTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg px-1.5 text-center text-[12px] font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:px-3 sm:text-sm md:min-h-9 ${active ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20" : "text-gray-600 hover:bg-primary-soft/60 hover:text-primary"}`}
    >
      {label}
    </button>
  );
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => globalThis.clearTimeout(timeoutId);
  }, [delay, value]);

  return debouncedValue;
}

function getDateRange(range: string): { from?: string; to?: string } {
  if (!range) {
    return {};
  }

  const today = new Date();
  const from = new Date(today);
  if (range === "7d") {
    from.setDate(from.getDate() - 6);
  }
  if (range === "30d") {
    from.setDate(from.getDate() - 29);
  }
  if (range === "90d") {
    from.setDate(from.getDate() - 89);
  }

  return {
    from: toLocalDate(from),
    to: toLocalDate(today),
  };
}

function toLocalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
