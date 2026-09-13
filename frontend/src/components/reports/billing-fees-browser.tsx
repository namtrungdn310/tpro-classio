"use client";

import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { getBillingFeePage, type BillingFeeFilters } from "@/lib/api/billing-reports";
import { getApiErrorMessage } from "@/lib/api/errors";
import { BillingFeesTable } from "./billing-fees-table";

export function BillingFeesBrowser({ enrollmentId }: { enrollmentId: string }) {
  const id = useId();
  const rows = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<BillingFeeFilters>({ year: "current", state: "ALL", includeInactive: false, order: "desc", page: 1 });
  const query = useQuery({
    queryKey: ["reports", "billing-fees", enrollmentId, filters],
    queryFn: ({ signal }) => getBillingFeePage(enrollmentId, filters, signal),
    staleTime: 30_000,
  });
  // Retain only metadata across requests, never rows from a different filter.
  const [metadata, setMetadata] = useState<typeof query.data>();
  if (query.data && query.data !== metadata) setMetadata(query.data);
  const change = (patch: Partial<BillingFeeFilters>) => {
    rows.current?.querySelector('[role="rowgroup"][tabindex]')?.scrollTo({ top: 0 });
    setFilters(f => ({ ...f, ...patch, page: patch.page ?? 1 }));
  };
  const data = query.data;
  const year = filters.year === "current" ? metadata?.current_year : Number(filters.year);
  const latestYear = metadata?.available_years.find(y => y !== metadata.current_year);
  return <section aria-label="Tra cứu khoản thu" className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <FormField label="Năm của kỳ thu" controlId={`${id}-year`}>
        <select id={`${id}-year`} className={formTextControlClassName} value={filters.year} onChange={e => change({ year: e.target.value })}>
          <option value="current">{metadata ? `${metadata.current_year} (hiện tại)` : "Năm hiện tại"}</option>
          {(metadata?.available_years ?? []).map(y => <option key={y} value={String(y)}>{y}</option>)}
          <option value="0">Tất cả năm</option>
        </select>
      </FormField>
      <FormField label="Trạng thái" controlId={`${id}-state`}>
        <select id={`${id}-state`} className={formTextControlClassName} value={filters.state} onChange={e => change({ state: e.target.value as BillingFeeFilters["state"] })}>
          <option value="ALL">Tất cả</option><option value="PENDING">Chưa thu / thu chưa đủ</option>
          <option value="PAID">Đã thu</option><option value="REFUNDED">Có hoàn tiền</option>
        </select>
      </FormField>
      <FormField label="Sắp xếp kỳ thu" controlId={`${id}-order`} className="col-span-2 sm:col-span-1">
        <select id={`${id}-order`} className={formTextControlClassName} value={filters.order} onChange={e => change({ order: e.target.value as "asc" | "desc" })}>
          <option value="desc">Mới nhất trước</option><option value="asc">Cũ nhất trước</option>
        </select>
      </FormField>
    </div>
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" autoComplete="off" checked={filters.includeInactive} onChange={e => change({ includeInactive: e.target.checked })} className="h-4 w-4 accent-primary" />
      Hiện khoản đã hủy / đã thay thế
    </label>
    <p className="text-xs text-gray-500">Năm theo ngày bắt đầu kỳ thu; thiếu ngày kỳ thì dùng hạn thu.</p>
    {data && filters.year !== "0" && data.older_pending_count > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
      Có {data.older_pending_count} khoản chưa thu thuộc các năm trước năm {year}.
      <Button variant="link" className="ml-1 h-auto p-0 text-primary" onClick={() => change({ year: "0", state: "PENDING", includeInactive: false })}>Xem khoản chưa thu</Button>
    </div>}
    {data && filters.year !== "0" && data.undated_pending_count > 0 && <div className="text-sm text-amber-900">
      Có {data.undated_pending_count} khoản chưa thu thiếu ngày cần kiểm tra.{" "}
      <Button variant="link" className="h-auto p-0" onClick={() => change({ year: "0", state: "PENDING", includeInactive: false })}>Xem tất cả năm</Button>
    </div>}
    <div ref={rows} aria-busy={query.isFetching}>
      {query.isError ? <div role="alert" className="rounded-md border border-destructive/20 p-3 text-sm text-destructive">
        {getApiErrorMessage(query.error, "Không tải được danh sách khoản thu")}
        <Button variant="outline" className="ml-2" onClick={() => void query.refetch()}>Thử lại danh sách</Button>
      </div> : !data ? <div className="flex min-h-32 items-center justify-center"><LoadingLabel label="Đang tải khoản thu" /></div>
        : data.items.length ? <BillingFeesTable fees={data.items} />
          : <div className="rounded-md border border-gray-200 p-5 text-center text-sm text-gray-500">
            Không có khoản thu phù hợp bộ lọc.
            {filters.year === "current" && latestYear && <Button variant="link" className="block w-full" onClick={() => change({ year: String(latestYear), state: "ALL", includeInactive: true })}>Xem năm {latestYear}</Button>}
          </div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2">
      <span role={data ? "status" : undefined} className="text-xs text-gray-600">{data ? `${data.total ? (data.page - 1) * data.page_size + 1 : 0}–${Math.min(data.page * data.page_size, data.total)} / ${data.total} khoản` : query.isError ? "Chưa tải được danh sách" : "Đang tải"}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!data || query.isFetching || data.page <= 1} onClick={() => change({ page: data!.page - 1 })}>Trước</Button>
        <Button variant="outline" size="sm" disabled={!data || query.isFetching || !data.has_next} onClick={() => change({ page: data!.page + 1 })}>Sau</Button>
      </div>
    </div>
  </section>;
}
