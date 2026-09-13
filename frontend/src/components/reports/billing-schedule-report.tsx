"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { getBillingReportEnrollments, getBillingReportHistory } from "@/lib/api/billing-reports";
import { getApiErrorMessage } from "@/lib/api/errors";
import { BillingFeesBrowser } from "./billing-fees-browser";
import { SuspensionHistory } from "./suspension-history";

const date = (s: string | null) => s ? s.split("-").reverse().join("/") : "—";

export function BillingScheduleReport() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ id: string; student_name: string; class_name: string; enrollment_date: string | null }>();
  useEffect(() => { const timer = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const query = useQuery({ queryKey: ["reports", "billing-enrollments", q, page], queryFn: ({ signal }) => getBillingReportEnrollments(q, page, signal) });
  return <div className="space-y-4 overflow-y-auto p-4">
    <h2 className="text-base font-semibold">Khoản thu và lịch sử đổi mốc</h2>
    <FormField label="Tìm học viên hoặc lớp" controlId="billing-report-search">
      <input id="billing-report-search" autoComplete="off" className={formTextControlClassName} value={search} maxLength={100} onChange={e => { setSearch(e.target.value); setSelected(undefined); }} />
    </FormField>
    {query.isError ? <div role="alert">{getApiErrorMessage(query.error, "Không tải được lượt học")} <Button type="button" variant="outline" onClick={() => void query.refetch()}>Thử lại</Button></div>
      : !query.data ? <LoadingLabel label="Đang tải lượt học" /> : <>
        <div className="grid gap-2 sm:grid-cols-2">
          {query.data.items.map(item => <button type="button" key={item.id} disabled={search !== q || query.isFetching} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}
            className={`min-h-11 rounded-md border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-primary ${selected?.id === item.id ? "border-primary bg-primary-soft" : "border-gray-200"}`}>
            <span className="block font-medium">{item.student_name} · {item.class_name}</span>
            <span className="text-xs text-gray-600">Ghi danh {date(item.enrollment_date)} · {({ active: "Đang học", dropped: "Đã nghỉ", completed: "Hoàn tất", cancelled: "Đã hủy" } as Record<string, string>)[item.status] ?? item.status} · {item.id.slice(0, 8)}</span>
          </button>)}
        </div>
        {!query.data.items.length && <p className="text-sm text-gray-600">Không có lượt học phù hợp.</p>}
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>Trang {query.data.page} · {query.data.total} lượt học</span>
          <Button type="button" variant="outline" disabled={query.isFetching || query.data.page <= 1} onClick={() => { setPage(query.data!.page - 1); setSelected(undefined); }}>Lượt học trước</Button>
          <Button type="button" variant="outline" disabled={query.isFetching || !query.data.has_next} onClick={() => { setPage(query.data!.page + 1); setSelected(undefined); }}>Lượt học sau</Button>
        </div>
      </>}
    {selected ? <section key={selected.id} aria-label="Báo cáo lượt học" className="space-y-5 border-t pt-4">
      <h3 className="font-semibold">{selected.student_name} · {selected.class_name} · ghi danh {date(selected.enrollment_date)}</h3>
      <BillingFeesBrowser enrollmentId={selected.id} />
      <BillingHistory enrollmentId={selected.id} />
      <SuspensionHistory enrollmentId={selected.id} />
    </section> : <p className="text-sm text-gray-600">Chọn một lượt học để tra cứu khoản thu và lịch sử đổi mốc.</p>}
  </div>;
}

function BillingHistory({ enrollmentId }: { enrollmentId: string }) {
  const [year, setYear] = useState("current");
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["reports", "billing-history", enrollmentId, year, page], queryFn: ({ signal }) => getBillingReportHistory(enrollmentId, year, page, signal) });
  const [years, setYears] = useState<number[]>([]);
  useEffect(() => { if (query.data) setYears(query.data.available_years); }, [query.data]);
  return <section aria-label="Lịch sử đổi mốc" className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Lịch sử đổi mốc thu</h3>
    <FormField label="Năm thực hiện điều chỉnh" controlId="billing-history-year" hint="Theo thời điểm thực hiện (giờ Việt Nam), không phải năm của kỳ thu.">
      <select id="billing-history-year" className={formTextControlClassName} value={year} onChange={e => { setYear(e.target.value); setPage(1); }}>
        <option value="current">Năm hiện tại</option>{years.map(y => <option key={y} value={String(y)}>{y}</option>)}<option value="0">Tất cả năm</option>
      </select>
    </FormField>
    {query.isError ? <div role="alert">{getApiErrorMessage(query.error, "Không tải được lịch sử")} <Button type="button" variant="outline" onClick={() => void query.refetch()}>Thử lại lịch sử</Button></div>
      : !query.data ? <LoadingLabel label="Đang tải lịch sử" /> : <>
        {!query.data.items.length && <p className="text-sm text-gray-600">Không có điều chỉnh trong thời gian đã chọn.</p>}
        <ol className="space-y-3">{query.data.items.map(item => <li key={item.id} className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">{date(item.old_date)} → {date(item.new_date)}</p>
          <p>{item.actor_name ?? "Tài khoản không còn thông tin"} · {new Date(item.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
          <p>Lý do: {item.reason}</p>
          <p>Đã áp dụng · {item.created_count} khoản tạo · {item.replaced_count} thay thế · {item.kept_count} giữ nguyên</p>
          <details><summary className="cursor-pointer text-primary">Chi tiết kết quả</summary>
            <p className="mt-2 text-xs text-gray-600">Kết quả tại thời điểm điều chỉnh; không phải số tiền đã thanh toán.</p>
            {item.charges.map((c, i) => <p key={i}>{date(c.coverage.start)} – trước {date(c.coverage.end)} · hạn {date(c.due_date)} · {c.amount.toLocaleString("vi-VN")}đ</p>)}
            {item.waived_intervals.map((w, i) => <p key={i}>Miễn thu: {date(w.start)} – trước {date(w.end)}</p>)}
            <p className="break-all text-xs text-gray-500">Mã điều chỉnh: {item.id}</p>
          </details>
        </li>)}</ol>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>Trang {query.data.page} · {query.data.total} điều chỉnh</span>
          <Button type="button" variant="outline" disabled={query.isFetching || query.data.page <= 1} onClick={() => setPage(query.data!.page - 1)}>Lịch sử trước</Button>
          <Button type="button" variant="outline" disabled={query.isFetching || !query.data.has_next} onClick={() => setPage(query.data!.page + 1)}>Lịch sử sau</Button>
        </div>
      </>}
  </section>;
}
