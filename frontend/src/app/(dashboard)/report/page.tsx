"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BellRing,
  BookOpenCheck,
  CheckCircle2,
  CircleDollarSign,
  History,
  MessageSquareText,
  RefreshCcw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { HeaderFilterControls } from "@/components/layout/header-filter-controls";
import { ReportPageSkeleton } from "@/components/reports/report-skeleton";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { getFeePeriods } from "@/lib/api/fees";
import { getFeeOperation, getFeeOperations } from "@/lib/api/reports";
import { useAuth } from "@/lib/hooks/useAuth";
import type {
  FeeOperation,
  FeeOperationAction,
  FeeOperationItem,
} from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime, formatPeriod } from "@/lib/utils/format";

const ACTION_META: Record<
  FeeOperationAction,
  { label: string; shortLabel: string; icon: typeof BellRing; tone: string; dot: string }
> = {
  notify: {
    label: "Đã báo học phí",
    shortLabel: "Báo học phí",
    icon: BellRing,
    tone: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  unnotify: {
    label: "Chuyển về chưa báo",
    shortLabel: "Bỏ trạng thái đã báo",
    icon: Undo2,
    tone: "bg-gray-100 text-gray-700",
    dot: "bg-gray-500",
  },
  payment: {
    label: "Ghi nhận đã nộp",
    shortLabel: "Đã nộp",
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  payment_reversal: {
    label: "Hoàn tác ghi nhận đã nộp",
    shortLabel: "Hoàn tác đã nộp",
    icon: RotateCcw,
    tone: "bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
  refund: {
    label: "Hoàn học phí",
    shortLabel: "Hoàn phí",
    icon: CircleDollarSign,
    tone: "bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
  refund_reversal: {
    label: "Hoàn tác hoàn học phí",
    shortLabel: "Hoàn tác hoàn phí",
    icon: RefreshCcw,
    tone: "bg-violet-50 text-violet-800",
    dot: "bg-violet-500",
  },
  sync: {
    label: "Đồng bộ kỳ học phí",
    shortLabel: "Đồng bộ kỳ",
    icon: BookOpenCheck,
    tone: "bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  template_update: {
    label: "Cập nhật nội dung Zalo",
    shortLabel: "Nội dung Zalo",
    icon: MessageSquareText,
    tone: "bg-indigo-50 text-indigo-800",
    dot: "bg-indigo-500",
  },
};

const ACTION_OPTIONS = [
  { value: "", label: "Tất cả" },
  ...Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.shortLabel })),
];

const RANGE_OPTIONS = [
  { value: "", label: "Toàn bộ" },
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
];

export default function ReportPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [action, setAction] = useState("");
  const [period, setPeriod] = useState("");
  const [range, setRange] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dates = useMemo(() => getDateRange(range), [range]);
  const filters = useMemo(
    () => ({
      action: action as FeeOperationAction | "",
      period,
      q: deferredSearch,
      date_from: dates.from,
      date_to: dates.to,
      limit: 30,
    }),
    [action, dates.from, dates.to, deferredSearch, period],
  );

  const periodsQuery = useQuery({
    queryKey: ["fee-periods"],
    queryFn: getFeePeriods,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
  const operationsQuery = useInfiniteQuery({
    queryKey: ["reports", "fee-operations", filters],
    queryFn: ({ pageParam }) => getFeeOperations({ ...filters, cursor: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const operations = useMemo(
    () => operationsQuery.data?.pages.flatMap((page) => page.operations) ?? [],
    [operationsQuery.data],
  );
  const summary = operationsQuery.data?.pages[0]?.summary;
  const historyCompleteFrom = operationsQuery.data?.pages[0]?.history_complete_from;

  useEffect(() => {
    if (operations.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !operations.some((operation) => operation.id === selectedId)) {
      setSelectedId(operations[0].id);
    }
  }, [operations, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["reports", "fee-operation", selectedId],
    queryFn: () => getFeeOperation(selectedId!),
    enabled: Boolean(selectedId),
    staleTime: 5 * 60 * 1000,
  });

  const periodOptions = [
    { value: "", label: "Tất cả" },
    ...(periodsQuery.data?.periods ?? []).map((value) => ({
      value,
      label: formatPeriod(value),
    })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <HeaderControlsPortal>
        <HeaderFilterControls
          searchPlaceholder="Tìm học viên, lớp, người thực hiện..."
          searchValue={search}
          onSearchChange={setSearch}
          onClear={() => {
            setAction("");
            setPeriod("");
            setRange("");
          }}
          filters={[
            {
              label: "Hoạt động",
              value: action,
              onChange: setAction,
              options: ACTION_OPTIONS,
              defaultValue: "",
            },
            {
              label: "Kỳ học phí",
              value: period,
              onChange: setPeriod,
              options: periodOptions,
              defaultValue: "",
            },
            {
              label: "Thời gian",
              value: range,
              onChange: setRange,
              options: RANGE_OPTIONS,
              defaultValue: "",
            },
          ]}
        />
      </HeaderControlsPortal>

      {operationsQuery.isPending ? (
        <ReportPageSkeleton />
      ) : operationsQuery.isError ? (
        <DataSectionError
          className="min-h-0 flex-1"
          title="Không tải được báo cáo học phí"
          description="Dữ liệu gốc vẫn được giữ nguyên. Vui lòng kiểm tra kết nối và thử lại."
          isRetrying={operationsQuery.isFetching}
          onRetry={() => void operationsQuery.refetch()}
        />
      ) : (
        <>
          <section className="grid shrink-0 grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white sm:grid-cols-3">
            <ReportMetric label="Hoạt động" value={summary?.operation_count ?? 0} hint="lần ghi nhận" />
            <ReportMetric label="Phạm vi" value={summary?.affected_item_count ?? 0} hint="khoản học phí" />
            <ReportMetric
              label="Biến động sổ tiền"
              value={formatSignedCurrency(summary?.financial_net_change ?? 0)}
              hint="thu trừ hoàn tác và hoàn phí"
              last
            />
          </section>

          {operations.length === 0 ? (
            <DataSectionEmpty
              className="min-h-0 flex-1"
              icon={History}
              title="Chưa có hoạt động phù hợp"
              description="Thử đổi từ khoá hoặc bộ lọc. Báo cáo không tự tạo dữ liệu thay cho lịch sử thực tế."
              actionLabel="Xoá bộ lọc"
              onAction={() => {
                setSearch("");
                setAction("");
                setPeriod("");
                setRange("");
              }}
            />
          ) : (
            <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(360px,0.84fr)_minmax(0,1.4fr)]">
              <div className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white xl:min-h-0">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50/70 px-4">
                  <p className="text-sm font-semibold text-gray-900">Dòng hoạt động</p>
                  <span className="text-xs font-medium tabular-nums text-gray-500">
                    {summary?.operation_count ?? operations.length} mục
                  </span>
                </div>
                <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {operations.map((operation) => (
                    <OperationRow
                      key={operation.id}
                      operation={operation}
                      selected={operation.id === selectedId}
                      onSelect={() => setSelectedId(operation.id)}
                    />
                  ))}
                  {operationsQuery.hasNextPage ? (
                    <div className="flex justify-center border-t border-gray-100 p-3">
                      <button
                        type="button"
                        onClick={() => void operationsQuery.fetchNextPage()}
                        disabled={operationsQuery.isFetchingNextPage}
                        className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {operationsQuery.isFetchingNextPage ? (
                          <LoadingLabel label="Đang tải thêm" />
                        ) : (
                          "Xem hoạt động cũ hơn"
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <OperationDetail
                operation={detailQuery.data ?? null}
                isLoading={detailQuery.isPending && Boolean(selectedId)}
                isError={detailQuery.isError}
                onRetry={() => void detailQuery.refetch()}
                historyCompleteFrom={historyCompleteFrom}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ReportMetric({ label, value, hint, last = false }: { label: string; value: string | number; hint: string; last?: boolean }) {
  return (
    <div className={`px-4 py-3.5 ${last ? "" : "border-b border-gray-100 sm:border-b-0 sm:border-r"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-500">{label}</p>
      <p className="mt-1 text-[19px] font-semibold tabular-nums leading-6 text-gray-950">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function OperationRow({ operation, selected, onSelect }: { operation: FeeOperation; selected: boolean; onSelect: () => void }) {
  const meta = ACTION_META[operation.action];
  const preview = operation.items[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${selected ? "bg-slate-50" : "hover:bg-gray-50/80"}`}
    >
      {selected ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-gray-900" aria-hidden="true" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <p className="truncate text-sm font-semibold text-gray-900">{meta.label}</p>
          </div>
          <p className="mt-1 truncate pl-4 text-[13px] text-gray-600">
            {formatSubject(preview, operation.item_count)}
          </p>
        </div>
        <time className="shrink-0 text-[11px] font-medium tabular-nums text-gray-500" dateTime={operation.occurred_at}>
          {formatCompactOperationTime(operation.occurred_at)}
        </time>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 pl-4 text-xs text-gray-500">
        <span className="truncate">{operation.actor_name || operation.actor_username || "Hệ thống"}</span>
        {operation.total_amount !== 0 ? (
          <span className={`shrink-0 font-semibold tabular-nums ${operation.total_amount > 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {formatSignedCurrency(operation.total_amount)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function OperationDetail({ operation, isLoading, isError, onRetry, historyCompleteFrom }: { operation: FeeOperation | null; isLoading: boolean; isError: boolean; onRetry: () => void; historyCompleteFrom: string | null | undefined }) {
  if (isLoading) {
    return <div className="min-h-[360px] animate-pulse rounded-lg border border-gray-200 bg-white p-5"><div className="h-5 w-52 rounded bg-gray-200" /><div className="mt-3 h-3 w-72 rounded bg-gray-100" /><div className="mt-6 h-52 rounded bg-gray-50" /></div>;
  }
  if (isError) {
    return <DataSectionError title="Không tải được chi tiết hoạt động" description="Danh sách vẫn dùng được. Vui lòng thử tải riêng phần chi tiết." onRetry={onRetry} />;
  }
  if (!operation) return null;
  const meta = ACTION_META[operation.action];
  const Icon = meta.icon;
  return (
    <article className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white xl:min-h-0">
      <header className="shrink-0 border-b border-gray-200 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-950">{meta.label}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{formatDateTime(operation.occurred_at)} · {operation.actor_name || operation.actor_username || "Hệ thống"}</p>
          </div>
          <span className="shrink-0 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-semibold tabular-nums text-gray-600">#{operation.sequence_no}</span>
        </div>
      </header>
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
          <DetailFact label="Kỳ" value={operation.period ? formatPeriod(operation.period) : "Nhiều kỳ"} />
          <DetailFact label="Phạm vi" value={`${operation.item_count} khoản`} />
          <DetailFact label="Biến động" value={formatSignedCurrency(operation.total_amount)} />
          <DetailFact label="Nguồn" value={operation.origin === "application" ? "Ứng dụng" : operation.origin === "migration" ? "Lịch sử cũ" : "Hệ thống"} />
        </dl>

        {operation.origin === "migration" ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Bản ghi tài chính này được nhập từ sổ thanh toán có trước khi bật báo cáo hoạt động. Hệ thống không suy đoán người thao tác hoặc trạng thái thông báo còn thiếu.</p>
        ) : null}

        <div className="mt-5 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">Chi tiết từng khoản</h3>
          <div className="mt-2 overflow-hidden rounded-md border border-gray-200">
            {operation.items.map((item) => <OperationItemRow key={item.id} item={item} action={operation.action} />)}
          </div>
        </div>

        {historyCompleteFrom ? (
          <p className="mt-4 text-[11px] leading-4 text-gray-400">Lịch sử thao tác đầy đủ từ {formatDateTime(historyCompleteFrom)}. Giao dịch cũ hơn được giữ theo dữ liệu tài chính có thể kiểm chứng.</p>
        ) : null}
      </div>
    </article>
  );
}

function OperationItemRow({ item, action }: { item: FeeOperationItem; action: FeeOperationAction }) {
  return (
    <div className="border-b border-gray-100 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-gray-900">{item.student_name || "Thiết lập hệ thống"}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">{item.class_name || (action === "template_update" ? "Nội dung tin nhắn" : "Không còn liên kết lớp")}{item.period ? ` · ${formatPeriod(item.period)}` : ""}</p>
        </div>
        {item.amount_delta !== 0 ? <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${item.amount_delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatSignedCurrency(item.amount_delta)}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        {item.state_before !== item.state_after ? <span>{formatState(item.state_before)} → {formatState(item.state_after)}</span> : null}
        {item.due_date_after ? <span>Đến hạn {formatDate(item.due_date_after)}</span> : null}
        {item.payment_method ? <span>{item.payment_method === "bank_transfer" ? "Chuyển khoản" : "Tiền mặt"}</span> : null}
      </div>
      {item.reason ? <p className="mt-2 text-xs leading-5 text-gray-600"><span className="font-medium text-gray-700">Lý do:</span> {item.reason}</p> : null}
      {action === "template_update" && item.message ? <p className="mt-2 line-clamp-3 whitespace-pre-line rounded bg-gray-50 px-2.5 py-2 text-xs leading-5 text-gray-600">{item.message}</p> : null}
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] font-medium text-gray-500">{label}</dt><dd className="mt-0.5 truncate text-[13px] font-semibold text-gray-900">{value}</dd></div>;
}

function formatSubject(item: FeeOperationItem | undefined, count: number) {
  if (!item) return `${count} khoản học phí`;
  const subject = [item.student_name, item.class_name].filter(Boolean).join(" · ");
  return count > 1 ? `${subject || "Nhiều khoản"} và ${count - 1} khoản khác` : subject || "Thiết lập hệ thống";
}

function formatState(value: string | null) {
  const labels: Record<string, string> = {
    UNNOTIFIED: "Chưa báo",
    NOTIFIED_UNPAID: "Đã báo",
    UNPAID: "Chưa nộp",
    PAID: "Đã nộp",
    REFUNDED_PARTIAL: "Hoàn một phần",
    REFUNDED_FULL: "Đã hoàn hết",
  };
  return value ? labels[value] ?? `Phiên bản ${value}` : "Không có";
}

function formatSignedCurrency(amount: number) {
  if (amount === 0) return "0đ";
  return `${amount > 0 ? "+" : "−"}${formatCurrency(Math.abs(amount))}`;
}

function formatCompactOperationTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) === today.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    ...(sameDay ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : { day: "2-digit", month: "2-digit" }),
  }).format(date);
}

function getDateRange(range: string): { from?: string; to?: string } {
  if (!range) return {};
  const today = new Date();
  const from = new Date(today);
  if (range === "7d") from.setDate(from.getDate() - 6);
  if (range === "30d") from.setDate(from.getDate() - 29);
  return { from: toLocalDate(from), to: toLocalDate(today) };
}

function toLocalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
