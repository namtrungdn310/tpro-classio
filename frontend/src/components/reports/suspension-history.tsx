"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { formTextControlClassName } from "@/components/ui/form-text-control";

const schema = z.object({
  items: z.array(z.object({ id: z.uuid(), created_at: z.iso.datetime({ offset: true }), actor_name: z.string().nullable(),
    kind: z.enum(["CLASS_CREATE", "CLASS_CHANGE", "INDIVIDUAL"]), action: z.enum(["SAVE", "CANCEL"]), reason: z.string(),
    suspended_from: z.iso.date().nullable(), resume_on: z.iso.date().nullable(), delta_days: z.number().int(), pending_days: z.number().int(),
    old_due_date: z.iso.date().nullable(), new_due_date: z.iso.date().nullable() })),
  total: z.number().int(), page: z.number().int(), has_next: z.boolean(), available_years: z.array(z.number().int()),
  ledger_days: z.number().int(), preserved_days: z.number().int(), pending_days: z.number().int(), reconciliation_days: z.number().int(), membership_closed: z.boolean(),
});

export function SuspensionHistory({ enrollmentId }: { enrollmentId: string }) {
  const [year, setYear] = useState("current"), [page, setPage] = useState(1);
  const [years, setYears] = useState<number[]>([]);
  const query = useQuery({ queryKey: ["reports", "suspension-history", enrollmentId, year, page],
    queryFn: async ({ signal }) => schema.parse((await apiClient.get(`/reports/billing/enrollments/${enrollmentId}/suspensions`,
      { params: { year: year === "current" ? undefined : Number(year), page }, signal })).data) });
  useEffect(() => { if (query.data) setYears(query.data.available_years); }, [query.data]);
  return <section aria-label="Lịch sử hoãn và bảo lưu" className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Hoãn và bảo lưu ngày học</h3>
    <p className="text-sm text-gray-600">Hoãn lớp và hoãn riêng của đúng lượt học này. Ngày trùng nhau chỉ được bảo lưu một lần; không phải khoản hoàn tiền.</p>
    <label className="flex flex-wrap items-center gap-2 text-sm">Năm ghi nhận (giờ Việt Nam)
      <select value={year} className={formTextControlClassName} onChange={e => { setYear(e.target.value); setPage(1); }}>
        <option value="current">Năm hiện tại</option>{years.map(y => <option key={y} value={y}>{y}</option>)}<option value="0">Tất cả năm</option>
      </select>
    </label>
    {query.isError ? <div role="alert">{getApiErrorMessage(query.error, "Chưa tải được bảo lưu")} <Button type="button" variant="outline" onClick={() => void query.refetch()}>Thử lại bảo lưu</Button></div>
      : !query.data ? <p role="status">Đang tải bảo lưu…</p> : <>
        <p className="text-sm">Toàn lượt học hiện tại: đã ghi nhận {query.data.ledger_days} ngày; {query.data.pending_days} ngày chờ bù trừ.</p>
        {query.data.membership_closed && query.data.pending_days !== 0 ? <p className="text-sm text-amber-800">Lượt học đã kết thúc. Phần chờ cần đối chiếu riêng; không tự chuyển sang lớp khác hoặc hoàn tiền.</p> : null}
        {query.data.reconciliation_days !== 0 ? <p role="status" className="text-sm text-amber-800">Cần đối chiếu: khoảng nghỉ và ngày ghi danh/miễn thu hiện tại tương ứng {query.data.preserved_days} ngày, chênh {query.data.reconciliation_days} ngày so với sổ bảo lưu. Khoản đã chốt vẫn giữ nguyên.</p> : null}
        {!query.data.items.length ? <p className="text-sm text-gray-600">Không có lần ghi nhận trong năm đã chọn.</p> : null}
        <ol className="space-y-3">{query.data.items.map(item => <li key={item.id} className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">{item.kind === "INDIVIDUAL" ? "Hoãn riêng" : "Hoãn lớp"} · {item.action === "CANCEL" ? "Hủy nhập nhầm" : item.kind === "CLASS_CREATE" ? "Tạo lần hoãn" : "Ghi nhận / điều chỉnh"}</p>
          <p>{new Date(item.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {item.actor_name ?? "Tài khoản không còn thông tin"}</p>
          {item.suspended_from ? <p>Nghỉ từ {formatDate(item.suspended_from)}{item.resume_on ? ` · học lại ${formatDate(item.resume_on)}` : ""}</p> : item.resume_on ? <p>Ngày học lại: {formatDate(item.resume_on)}</p> : null}
          <p className="whitespace-pre-wrap break-words">{item.reason}</p>
          <p>Tại thời điểm xác nhận: {item.delta_days > 0 ? "+" : ""}{item.delta_days} ngày; chờ bù trừ {item.pending_days} ngày.</p>
          {item.old_due_date && item.new_due_date ? <p>Ngày thu {formatDate(item.old_due_date)} → {formatDate(item.new_due_date)}</p> : null}
          <details><summary className="min-h-11 cursor-pointer py-2 text-gray-600">Mã đối chiếu</summary><p className="break-all">{item.id}</p></details>
        </li>)}</ol>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>Trang {query.data.page} · {query.data.total} lần ghi nhận</span>
          <Button type="button" variant="outline" disabled={query.isFetching || query.data.page <= 1} onClick={() => setPage(query.data!.page - 1)}>Bảo lưu trước</Button>
          <Button type="button" variant="outline" disabled={query.isFetching || !query.data.has_next} onClick={() => setPage(query.data!.page + 1)}>Bảo lưu sau</Button>
        </div>
      </>}
  </section>;
}
