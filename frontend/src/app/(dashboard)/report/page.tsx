"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RiReceiptLine as ReceiptText } from "react-icons/ri";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { PaidReceiptDetail } from "@/components/reports/paid-receipt-detail";
import { PaidReceiptTable } from "@/components/reports/paid-receipt-table";
import { PaidReportSummaryBand } from "@/components/reports/paid-report-summary";
import { ReportPageSkeleton } from "@/components/reports/report-skeleton";
import {
  DataSectionEmpty,
  DataSectionError,
} from "@/components/ui/data-section-state";
import { getFeePeriods } from "@/lib/api/fees";
import {
  getFeePaidReceipt,
  getFeePaidReceipts,
  type FeePaidReceiptFilters,
} from "@/lib/api/reports";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  EMPTY_PAID_REPORT_SUMMARY,
} from "@/lib/reports/paid-report-view-model";
import type {
  FeePaidReceiptRefundState,
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

export default function ReportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [period, setPeriod] = useState("");
  const [range, setRange] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [refundState, setRefundState] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dates = useMemo(() => getDateRange(range), [range]);

  const filters = useMemo<FeePaidReceiptFilters>(
    () => ({
      period,
      q: debouncedSearch,
      date_from: dates.from,
      date_to: dates.to,
      payment_method: paymentMethod as FeePaymentMethod | "",
      refund_state: refundState as FeePaidReceiptRefundState | "",
      limit: 30,
    }),
    [
      dates.from,
      dates.to,
      debouncedSearch,
      paymentMethod,
      period,
      refundState,
    ],
  );

  const periodsQuery = useQuery({
    queryKey: ["fee-periods"],
    queryFn: getFeePeriods,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const receiptsQuery = useInfiniteQuery({
    queryKey: ["reports", "fee-paid", filters],
    queryFn: ({ pageParam, signal }) =>
      getFeePaidReceipts({ ...filters, cursor: pageParam }, signal),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user),
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
    enabled: Boolean(selectedId),
    staleTime: 2 * 60 * 1000,
  });

  const handlePrefetch = useCallback(
    (receiptId: string) => {
      void queryClient.prefetchQuery({
        queryKey: ["reports", "fee-paid-detail", receiptId],
        queryFn: ({ signal }) => getFeePaidReceipt(receiptId, signal),
        staleTime: 2 * 60 * 1000,
      });
    },
    [queryClient],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setPeriod("");
    setRange("");
    setPaymentMethod("");
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
  const hasActiveFilters = Boolean(
    search || period || range || paymentMethod || refundState,
  );
  const isInitialLoading = receiptsQuery.isPending && !receiptsQuery.data;
  const isInitialError = receiptsQuery.isError && !receiptsQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderControlsPortal>
        <HeaderFilterControls
          searchPlaceholder="Tìm học viên, lớp, mã phiếu..."
          searchValue={search}
          onSearchChange={(value) => setSearch(value.slice(0, 100))}
          onClear={clearFilters}
          filters={[
            {
              label: "Kỳ học phí",
              value: period,
              onChange: setPeriod,
              options: periodOptions,
              defaultValue: "",
            },
            {
              label: "Ngày nộp",
              value: range,
              onChange: setRange,
              options: RANGE_OPTIONS,
              defaultValue: "",
            },
            {
              label: "Hình thức",
              value: paymentMethod,
              onChange: setPaymentMethod,
              options: PAYMENT_METHOD_OPTIONS,
              defaultValue: "",
            },
            {
              label: "Hoàn phí",
              value: refundState,
              onChange: setRefundState,
              options: REFUND_STATE_OPTIONS,
              defaultValue: "",
            },
          ]}
        />
      </HeaderControlsPortal>

      {isInitialLoading ? (
        <ReportPageSkeleton />
      ) : isInitialError ? (
        <DataSectionError
          className="min-h-0 flex-1"
          title="Không tải được sổ thu học phí"
          description="Dữ liệu tài chính vẫn được giữ nguyên. Vui lòng kiểm tra kết nối và thử lại."
          isRetrying={receiptsQuery.isFetching}
          onRetry={() => void receiptsQuery.refetch()}
        />
      ) : (
        <section className="flex h-full min-h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.65)] md:min-h-0">
          <PaidReportSummaryBand
            summary={summary}
            isRefreshing={
              receiptsQuery.isFetching &&
              !receiptsQuery.isFetchingNextPage &&
              !isInitialLoading
            }
          />

          {receiptsQuery.isError && receiptsQuery.data ? (
            <div
              role="alert"
              className="flex shrink-0 items-center justify-between gap-4 border-b border-rose-100 bg-rose-50/70 px-5 py-2 text-[12px] text-rose-800"
            >
              <span>Chưa thể cập nhật dữ liệu mới nhất. Danh sách gần nhất vẫn được giữ.</span>
              <button
                type="button"
                onClick={() => void receiptsQuery.refetch()}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Thử lại
              </button>
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 2xl:grid-cols-[minmax(0,1fr)_390px]">
            <div className="flex min-h-0 flex-col overflow-hidden">
              {receipts.length === 0 ? (
                <DataSectionEmpty
                  className="min-h-0 flex-1 rounded-none border-0 bg-white"
                  icon={ReceiptText}
                  title={
                    hasActiveFilters
                      ? "Không có phiếu thu phù hợp"
                      : "Chưa có khoản học phí đã nộp"
                  }
                  description={
                    hasActiveFilters
                      ? "Thử thay đổi từ khoá hoặc bộ lọc để xem các phiếu thu khác."
                      : "Phiếu thu sẽ xuất hiện tại đây sau khi học phí được ghi nhận."
                  }
                  actionLabel={hasActiveFilters ? "Xoá bộ lọc" : undefined}
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
        </section>
      )}
    </div>
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
