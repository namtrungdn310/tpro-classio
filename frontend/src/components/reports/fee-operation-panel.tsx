"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { RiCloseLine, RiHistoryLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { getFeeOperation, getFeeOperations, type FeeOperationFilters } from "@/lib/api/reports";
import type { FeeOperation, FeeOperationAction } from "@/lib/types";
import { formatStudentCode } from "@/lib/students/student-code";
import { formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";

const ACTION_LABELS: Record<FeeOperationAction, string> = {
  notify: "Gửi nhắc học phí",
  unnotify: "Hủy trạng thái đã nhắc",
  payment: "Ghi nhận học phí",
  payment_reversal: "Hoàn tác ghi nhận",
  refund: "Hoàn học phí",
  refund_reversal: "Hoàn tác hoàn phí",
  sync: "Đồng bộ học phí",
  sync_void: "Hủy khoản đồng bộ",
  supersede: "Thay thế lịch thu",
  anchor_recalculation: "Tính lại lịch thu",
  billing_cycle_change: "Đổi thời lượng gói",
  template_update: "Cập nhật mẫu nhắc phí",
};

type FeeOperationPanelProps = {
  filters: FeeOperationFilters;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
};

export function FeeOperationPanel({ filters, hasActiveFilters, onClearFilters }: FeeOperationPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["reports", "fee-operations", filters],
    queryFn: ({ pageParam, signal }) => getFeeOperations({ ...filters, cursor: pageParam }, signal),
    initialPageParam: "",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const operations = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.operations), [query.data]);
  const summary = query.data?.pages[0]?.summary;
  const detail = useQuery({
    queryKey: ["reports", "fee-operation", selectedId],
    queryFn: ({ signal }) => getFeeOperation(selectedId!, signal),
    enabled: Boolean(selectedId),
    staleTime: 120_000,
  });

  if (query.isPending && !query.data) return <OperationSkeleton />;
  if (query.isError && !query.data) {
    return <DataSectionError className="min-h-0 flex-1 rounded-none border-0" title="Không tải được nhật ký học phí" description="Dữ liệu vẫn được giữ nguyên. Hãy kiểm tra kết nối và thử lại." isRetrying={query.isFetching} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-3 border-b border-gray-200 bg-white">
        <Summary label="Hoạt động" value={summary?.operation_count ?? 0} />
        <Summary label="Khoản tác động" value={summary?.affected_item_count ?? 0} />
        <Summary label="Biến động" value={formatCurrency(summary?.financial_net_change ?? 0)} />
      </div>
      {operations.length === 0 ? (
        <DataSectionEmpty className="min-h-0 flex-1 rounded-none border-0" icon={RiHistoryLine} title={hasActiveFilters ? "Không có hoạt động phù hợp" : "Chưa có hoạt động học phí"} description={hasActiveFilters ? "Thử thay đổi từ khóa hoặc bộ lọc." : "Các thao tác học phí sẽ xuất hiện tại đây."} actionLabel={hasActiveFilters ? "Xóa bộ lọc" : undefined} onAction={hasActiveFilters ? onClearFilters : undefined} />
      ) : (
        <div className="grid min-h-0 flex-1 2xl:grid-cols-[minmax(0,1fr)_390px]">
          <div role="table" aria-label="Nhật ký học phí" className="min-h-0 overflow-hidden">
            <div role="row" className="grid grid-cols-[minmax(0,1.5fr)_minmax(130px,.7fr)_minmax(110px,.55fr)_minmax(120px,.6fr)] border-b border-gray-200 bg-gray-50 table-heading-text text-gray-600">
              <div role="columnheader" className="px-5 py-3">Hoạt động</div><div role="columnheader" className="px-3 py-3">Người thao tác</div><div role="columnheader" className="px-3 py-3">Ngày</div><div role="columnheader" className="px-3 py-3 text-right">Biến động</div>
            </div>
            <div role="rowgroup" className="scrollbar-hidden h-[calc(100%-41px)] overflow-y-auto">
              {operations.map((operation) => <OperationRow key={operation.id} operation={operation} selected={operation.id === selectedId} onSelect={setSelectedId} />)}
              {query.hasNextPage ? <div className="flex justify-center border-t border-gray-100 p-3"><Button type="button" variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? <LoadingLabel label="Đang tải" /> : "Xem thêm"}</Button></div> : null}
            </div>
          </div>
          <OperationDetail operation={detail.data ?? null} selectedId={selectedId} isLoading={detail.isPending && Boolean(selectedId)} isError={detail.isError} onClose={() => setSelectedId(null)} onRetry={() => void detail.refetch()} />
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return <div className="border-r border-gray-200 px-4 py-3 last:border-r-0"><p className="text-[13px] font-medium text-gray-500">{label}</p><p className="mt-0.5 text-[15px] font-semibold tabular-nums text-gray-950">{value}</p></div>;
}

function OperationRow({ operation, selected, onSelect }: { operation: FeeOperation; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" role="row" aria-current={selected ? "true" : undefined} onClick={() => onSelect(operation.id)} className={`grid w-full grid-cols-[minmax(0,1.5fr)_minmax(130px,.7fr)_minmax(110px,.55fr)_minmax(120px,.6fr)] border-b border-gray-100 text-left text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${selected ? "bg-primary-soft/70" : "hover:bg-gray-50"}`}>
    <span role="cell" className="min-w-0 px-5 py-3"><span className="block truncate font-semibold text-gray-950">{ACTION_LABELS[operation.action]}</span><span className="mt-0.5 block truncate text-[13px] text-gray-500">{operation.period ? formatPeriod(operation.period) : `${operation.item_count} khoản`}</span></span>
    <span role="cell" className="truncate px-3 py-3 text-gray-700">{operation.actor_name || operation.actor_username || "Hệ thống"}</span>
    <time role="cell" dateTime={operation.occurred_at} className="px-3 py-3 tabular-nums text-gray-700">{formatDate(operation.business_date)}</time>
    <span role="cell" className="px-3 py-3 text-right font-semibold tabular-nums text-gray-950">{formatCurrency(operation.total_amount)}</span>
  </button>;
}

function OperationDetail({ operation, selectedId, isLoading, isError, onClose, onRetry }: { operation: FeeOperation | null; selectedId: string | null; isLoading: boolean; isError: boolean; onClose: () => void; onRetry: () => void }) {
  if (!selectedId) {
    return <aside aria-label="Chi tiết hoạt động" className="hidden min-h-0 border-l border-gray-200 bg-gray-50/50 2xl:flex 2xl:flex-col"><div className="flex h-12 shrink-0 items-center border-b border-gray-200 bg-white px-4"><h2 className="text-[15px] font-semibold text-gray-950">Chi tiết hoạt động</h2></div><div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-6 text-gray-500">Chọn một hoạt động để xem chi tiết.</div></aside>;
  }
  return <><button type="button" aria-label="Đóng chi tiết" onClick={onClose} className="fixed inset-0 z-40 bg-gray-950/25 2xl:hidden"/><aside aria-label="Chi tiết hoạt động" className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] min-h-0 flex-col border-l border-gray-200 bg-gray-50/50 shadow-2xl 2xl:static 2xl:z-auto 2xl:w-auto 2xl:shadow-none">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4"><h2 className="text-[15px] font-semibold text-gray-950">Chi tiết hoạt động</h2>{selectedId ? <button type="button" aria-label="Đóng chi tiết" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><RiCloseLine className="h-5 w-5" /></button> : null}</div>
    {isLoading ? <div className="flex-1 animate-pulse space-y-3 p-4"><div className="h-20 rounded-lg bg-gray-100"/><div className="h-28 rounded-lg bg-gray-100"/></div> : isError ? <DataSectionError className="min-h-0 flex-1 rounded-none border-0" title="Chưa tải được chi tiết" description="Hãy thử lại." onRetry={onRetry} /> : operation ? <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-4"><div className="rounded-xl border border-gray-200 bg-white p-4"><p className="font-semibold text-gray-950">{ACTION_LABELS[operation.action]}</p><p className="mt-1 text-[13px] text-gray-500">{formatDate(operation.business_date)} · {operation.actor_name || operation.actor_username || "Hệ thống"}</p><p className="mt-3 text-xl font-semibold tabular-nums text-gray-950">{formatCurrency(operation.total_amount)}</p></div><div className="mt-3 space-y-2">{operation.items.map((item) => <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3"><p className="text-[15px] font-semibold text-gray-950">{item.student_name || "Khoản học phí"}</p>{item.student_code ? <p className="mt-0.5 text-[13px] font-medium tabular-nums text-primary">{formatStudentCode(item.student_code)}</p> : null}<p className="mt-1 text-[13px] leading-5 text-gray-500">{item.class_name || item.reason || stateLabel(item.state_before, item.state_after)}</p><p className="mt-2 font-semibold tabular-nums text-gray-950">{formatCurrency(item.amount_delta)}</p></div>)}</div></div> : null}
  </aside></>;
}

function stateLabel(before: string | null, after: string | null) { return before && after ? `${before} → ${after}` : "Đã ghi nhận thay đổi"; }
function OperationSkeleton() { return <div className="min-h-0 flex-1 animate-pulse"><div className="h-16 border-b border-gray-200 bg-gray-100" />{[1,2,3,4,5].map((item) => <div key={item} className="h-16 border-b border-gray-100 bg-white" />)}</div>; }
