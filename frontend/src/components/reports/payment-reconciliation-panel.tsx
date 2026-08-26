"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RiAlertLine, RiCheckboxCircleLine, RiCloseLine, RiRefreshLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { useToast } from "@/components/providers/toast-provider";
import { getPaymentRequests } from "@/lib/api/fees";
import { getPaymentReconciliation, resolvePaymentReconciliation } from "@/lib/api/reports";
import { exportReconciliation } from "@/lib/reports/export";
import type { PaymentReconciliationItem } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

const REASON_LABELS: Record<string, string> = {
  unmatched_reference_or_amount: "Không khớp nội dung hoặc số tiền",
  receiving_account_mismatch: "Không khớp tài khoản nhận",
  invalid_amount: "Số tiền không hợp lệ",
  outgoing_transfer: "Giao dịch tiền ra",
  provider_disabled: "Kết nối Pay2S đang tắt",
  auto_post_disabled: "Tự động ghi nhận đang tắt",
  provider_payment_failed: "Pay2S báo giao dịch thất bại",
};

export function PaymentReconciliationPanel() {
  const queryClient = useQueryClient();
  const notify = useToast();
  const [selected, setSelected] = useState<PaymentReconciliationItem | null>(null);
  const [ignoring, setIgnoring] = useState<PaymentReconciliationItem | null>(null);
  const [requestId, setRequestId] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const reconciliation = useQuery({ queryKey: ["reports", "payment-reconciliation", "REVIEW"], queryFn: ({ signal }) => getPaymentReconciliation("REVIEW", signal), staleTime: 15_000, refetchInterval: 30_000 });
  const requests = useQuery({ queryKey: ["fees", "payment-requests", "OPEN"], queryFn: () => getPaymentRequests("OPEN"), enabled: Boolean(selected), staleTime: 20_000 });
  const openRequests = useMemo(() => requests.data?.requests ?? [], [requests.data]);
  const mutation = useMutation({
    mutationFn: ({ item, action, paymentRequestId }: { item: PaymentReconciliationItem; action: "retry" | "manual_match" | "ignore"; paymentRequestId?: string }) => resolvePaymentReconciliation(item.id, { action, payment_request_id: paymentRequestId || undefined, reason: action === "retry" ? "Thử khớp lại theo dữ liệu hiện tại" : action === "manual_match" ? "Admin xác nhận ghép đúng yêu cầu học phí" : "Admin xác nhận bỏ qua giao dịch không ghi nhận" }),
    onSuccess: async () => { setSelected(null); setIgnoring(null); setRequestId(""); await Promise.all([queryClient.invalidateQueries({ queryKey: ["reports"] }), queryClient.invalidateQueries({ queryKey: ["fees"] })]); },
  });

  if (reconciliation.isPending) return <ReconciliationSkeleton />;
  if (reconciliation.isError) return <DataSectionError className="min-h-0 flex-1 rounded-none border-0" title="Không tải được giao dịch cần kiểm tra" description="Hãy kiểm tra kết nối rồi thử lại. Không có giao dịch nào bị tự động ghi nhận trong lúc lỗi." isRetrying={reconciliation.isFetching} onRetry={() => void reconciliation.refetch()} />;
  const items = reconciliation.data?.items ?? [];

  async function handleExport() {
    if (!items.length || isExporting) return;
    setIsExporting(true);
    try { const count = await exportReconciliation(items); notify.success(`Đã xuất danh sách ${count} giao dịch cần kiểm tra ra file Excel.`); }
    catch { notify.error("Không thể xuất danh sách giao dịch cần kiểm tra. Vui lòng thử lại."); }
    finally { setIsExporting(false); }
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-3">
      <div><p className="text-[15px] font-semibold text-gray-950">Cần kiểm tra <span className="ml-1 text-[13px] font-medium tabular-nums text-gray-500">{reconciliation.data?.review_count ?? 0}</span></p><p className="mt-0.5 text-[13px] leading-5 text-gray-500">Chỉ giao dịch chưa khớp mới xuất hiện tại đây.</p></div>
      <ExcelExportButton disabled={!items.length} isExporting={isExporting} onClick={() => void handleExport()} />
    </div>
    {!items.length ? <DataSectionEmpty className="min-h-0 flex-1 rounded-none border-0" icon={RiCheckboxCircleLine} title="Không có giao dịch chờ xử lý" description="Các giao dịch Pay2S đã được ghi nhận hoặc không có dữ liệu bất thường." /> : <div className="grid min-h-0 flex-1 2xl:grid-cols-[minmax(0,1fr)_390px]">
      <div role="table" aria-label="Giao dịch cần kiểm tra" className="min-h-0 overflow-hidden">
        <div role="row" className="grid grid-cols-[minmax(0,1.5fr)_minmax(150px,.7fr)_minmax(130px,.6fr)] border-b border-gray-200 bg-gray-50 table-heading-text text-gray-600"><div role="columnheader" className="px-5 py-3">Nội dung</div><div role="columnheader" className="px-3 py-3">Tài khoản nhận</div><div role="columnheader" className="px-3 py-3 text-right">Số tiền</div></div>
        <div role="rowgroup" className="scrollbar-hidden h-[calc(100%-41px)] overflow-y-auto">{items.map((item) => <button key={item.id} type="button" role="row" aria-current={selected?.id === item.id ? "true" : undefined} onClick={() => { setSelected(item); setRequestId(""); }} className={`grid w-full grid-cols-[minmax(0,1.5fr)_minmax(150px,.7fr)_minmax(130px,.6fr)] border-b border-gray-100 text-left text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 ${selected?.id === item.id ? "bg-primary-soft/70" : "hover:bg-gray-50"}`}><span role="cell" className="min-w-0 px-5 py-3"><span className="flex items-center gap-2 truncate font-semibold text-gray-950"><RiAlertLine className="h-4 w-4 shrink-0 text-amber-600" />{item.review_reason ? REASON_LABELS[item.review_reason] || "Cần kiểm tra" : "Cần kiểm tra"}</span><span className="mt-0.5 block truncate text-[13px] text-gray-500">{item.content || "Không có nội dung"}</span></span><span role="cell" className="truncate px-3 py-3 text-gray-700">{item.bank_name || "Pay2S"}{item.account_number ? ` · ${maskAccount(item.account_number)}` : ""}</span><span role="cell" className="px-3 py-3 text-right font-semibold tabular-nums text-gray-950">{item.amount === null ? "—" : formatCurrency(item.amount)}</span></button>)}</div>
      </div>
      <ReconciliationDetail item={selected} openRequests={openRequests} requestId={requestId} setRequestId={setRequestId} isPending={mutation.isPending} error={mutation.error} onClose={() => { setSelected(null); setRequestId(""); }} onRetry={(item) => mutation.mutate({ item, action: "retry" })} onMatch={(item) => mutation.mutate({ item, action: "manual_match", paymentRequestId: requestId })} onIgnore={setIgnoring} />
    </div>}
    <ConfirmationDialog open={Boolean(ignoring)} title="Bỏ qua giao dịch này?" description="Giao dịch sẽ không được ghi nhận vào học phí. Chỉ thực hiện sau khi đã kiểm tra." confirmLabel="Bỏ qua" pendingLabel="Đang xử lý" tone="danger" isPending={mutation.isPending} onCancel={() => setIgnoring(null)} onConfirm={() => ignoring && mutation.mutate({ item: ignoring, action: "ignore" })} />
  </div>;
}

function ReconciliationDetail({ item, openRequests, requestId, setRequestId, isPending, error, onClose, onRetry, onMatch, onIgnore }: { item: PaymentReconciliationItem | null; openRequests: Awaited<ReturnType<typeof getPaymentRequests>>["requests"]; requestId: string; setRequestId: (value: string) => void; isPending: boolean; error: unknown; onClose: () => void; onRetry: (item: PaymentReconciliationItem) => void; onMatch: (item: PaymentReconciliationItem) => void; onIgnore: (item: PaymentReconciliationItem) => void }) {
  if (!item) return <aside className="hidden border-l border-gray-200 bg-gray-50/50 2xl:flex 2xl:items-center 2xl:justify-center 2xl:px-6 2xl:text-center 2xl:text-sm 2xl:text-gray-500">Chọn một giao dịch để kiểm tra.</aside>;
  const canRecord = canRecordPayment(item);
  return <><button type="button" aria-label="Đóng chi tiết" onClick={onClose} className="fixed inset-0 z-40 bg-gray-950/25 2xl:hidden"/><aside aria-label="Chi tiết giao dịch cần kiểm tra" className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] flex-col border-l border-gray-200 bg-white shadow-2xl 2xl:static 2xl:z-auto 2xl:w-auto 2xl:shadow-none"><div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4"><h2 className="text-[15px] font-semibold text-gray-950">Chi tiết giao dịch</h2><button type="button" aria-label="Đóng chi tiết" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"><RiCloseLine className="h-5 w-5" /></button></div><div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-4"><div className="rounded-xl border border-gray-200 p-4"><p className="text-[13px] font-medium text-gray-500">Số tiền</p><p className="mt-1 text-xl font-semibold tabular-nums text-gray-950">{item.amount === null ? "—" : formatCurrency(item.amount)}</p><dl className="mt-4 space-y-3 text-[14px]"><div><dt className="text-gray-500">Nội dung chuyển khoản</dt><dd className="mt-0.5 break-words font-medium text-gray-900">{item.content || "Không có"}</dd></div><div><dt className="text-gray-500">Mã giao dịch</dt><dd className="mt-0.5 break-all font-medium text-gray-900">{item.provider_transaction_id || "Không có"}</dd></div></dl></div>{canRecord ? <label className="mt-4 block text-sm font-medium text-gray-800">Yêu cầu học phí cần ghép<select value={requestId} onChange={(event) => setRequestId(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-[15px] text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"><option value="">Chọn yêu cầu đang mở</option>{openRequests.map((request) => <option key={request.id} value={request.id}>{request.items[0]?.student_code || request.payment_reference} · {formatCurrency(request.expected_amount)}</option>)}</select></label> : null}{error ? <p role="alert" className="mt-3 text-sm text-destructive">{getErrorMessage(error)}</p> : null}</div><div className="shrink-0 space-y-2 border-t border-gray-200 p-4">{canRecord ? <><Button type="button" variant="outline" className="w-full" disabled={isPending} onClick={() => onRetry(item)}><RiRefreshLine />{isPending ? <LoadingLabel label="Đang thử lại" /> : "Thử khớp lại"}</Button><Button type="button" className="w-full" disabled={!requestId || isPending} onClick={() => onMatch(item)}>Ghép yêu cầu</Button></> : null}<Button type="button" variant="outline" className="w-full" disabled={isPending} onClick={() => onIgnore(item)}>Bỏ qua</Button></div></aside></>;
}

function maskAccount(value: string) { return value.length <= 4 ? value : `••••${value.slice(-4)}`; }
function canRecordPayment(item: PaymentReconciliationItem) { const transferType = item.transfer_type?.toUpperCase(); const successfulProviderResult = !item.result_code || item.result_code === "0"; return (!transferType || transferType === "IN") && successfulProviderResult && item.amount !== null && item.amount > 0 && Boolean(item.bank_account_id); }
function getErrorMessage(error: unknown) { return typeof error === "object" && error && "message" in error ? String(error.message) : "Chưa thể xử lý giao dịch. Vui lòng thử lại."; }
function ReconciliationSkeleton() { return <div className="min-h-0 flex-1 animate-pulse"><div className="h-16 border-b border-gray-200 bg-gray-100" />{[1,2,3,4,5].map((item) => <div key={item} className="h-16 border-b border-gray-100 bg-white" />)}</div>; }
