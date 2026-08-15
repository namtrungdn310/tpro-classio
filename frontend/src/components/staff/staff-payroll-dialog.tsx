"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { InlineFormError } from "@/components/ui/inline-form-error";
import { LoadingLabel } from "@/components/ui/loading-label";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createStaffCompensationRate, getStaffPayroll, reverseStaffPayrollSettlement, settleStaffPayroll } from "@/lib/api/staff";
import { getApiErrorMessage } from "@/lib/api/errors";

const money = new Intl.NumberFormat("vi-VN");

export function StaffPayrollDialog({ staffId, staffName, onClose }: { staffId: string; staffName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = ["staff-payroll", staffId] as const;
  const payroll = useQuery({ queryKey: key, queryFn: () => getStaffPayroll(staffId) });
  const [rate, setRate] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<"bank_transfer" | "cash">("bank_transfer");
  const [error, setError] = useState("");
  const [reversalTargetId, setReversalTargetId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const rateMutation = useMutation({
    mutationFn: () => createStaffCompensationRate(staffId, { rate_amount: rate ?? 0, effective_from: effectiveFrom }),
    onSuccess: async () => { setRate(null); setError(""); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể lưu mức thù lao.")),
  });
  const settlementMutation = useMutation({
    mutationFn: () => settleStaffPayroll(staffId, { request_id: crypto.randomUUID(), method }),
    onSuccess: async () => { setError(""); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể tất toán thù lao.")),
  });
  const reversalMutation = useMutation({
    mutationFn: () => reverseStaffPayrollSettlement(staffId, reversalTargetId ?? "", {
      request_id: crypto.randomUUID(), reason: reversalReason.trim(),
    }),
    onSuccess: async () => {
      setError(""); setReversalTargetId(null); setReversalReason("");
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể hoàn tác lần tất toán.")),
  });
  const busy = rateMutation.isPending || settlementMutation.isPending || reversalMutation.isPending;
  const summary = payroll.data;

  return (
    <FormDialogShell title="Thù lao nhân sự" subtitle={staffName} width="sm" isBusy={busy} onClose={onClose}>
      <FormDialogBody className="space-y-4">
        {payroll.isError ? <InlineFormError action={<button type="button" className="text-sm font-semibold underline" onClick={() => void payroll.refetch()}>Thử lại</button>}>Không tải được dữ liệu thù lao.</InlineFormError> : null}
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-600">Chưa tất toán</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950">{money.format(summary?.balance ?? 0)}đ</p>
        </section>
        <section className="space-y-3 border-t border-gray-200 pt-4">
          <h3 className="text-base font-semibold text-gray-900">Mức thù lao mỗi buổi</h3>
          <SmartMoneyInput value={rate} onChange={setRate} placeholder="Nhập số tiền" disabled={busy} />
          <label className="block text-sm font-medium text-gray-700">Hiệu lực từ
            <input type="text" inputMode="numeric" autoComplete="off" placeholder="YYYY-MM-DD" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={busy} className="form-input-text mt-1 h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-[15px] outline-none focus:border-primary" />
          </label>
          <button type="button" disabled={!rate || !effectiveFrom || busy} onClick={() => rateMutation.mutate()} className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
            {rateMutation.isPending ? <LoadingLabel label="Đang lưu" /> : "Lưu mức thù lao"}
          </button>
          {summary?.rates[0] ? <p className="text-sm text-gray-500">Hiện tại: {money.format(summary.rates[0].rate_amount)}đ / buổi</p> : null}
        </section>
        <section className="space-y-3 border-t border-gray-200 pt-4">
          <h3 className="text-base font-semibold text-gray-900">Tất toán</h3>
          <p id="payroll-settlement-method" className="sr-only">Hình thức tất toán</p>
          <SegmentedControl ariaLabelledBy="payroll-settlement-method" selected={method} onSelect={(value) => setMethod(value as typeof method)} options={[{ value: "bank_transfer", label: "Chuyển khoản" }, { value: "cash", label: "Tiền mặt" }]} />
          <p className="text-sm leading-5 text-gray-500">Tất toán tạo bút toán mới; lịch sử chấm công và thù lao không bị xóa.</p>
        </section>
        {summary?.settlements.length ? (
          <section className="space-y-2 border-t border-gray-200 pt-4">
            <h3 className="text-base font-semibold text-gray-900">Lịch sử tất toán</h3>
            {summary.settlements.map((settlement) => (
              <div key={settlement.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold tabular-nums text-gray-900">{money.format(settlement.total_amount)}đ</p>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {new Date(settlement.created_at).toLocaleString("vi-VN")} · {settlement.method === "cash" ? "Tiền mặt" : "Chuyển khoản"}
                    </p>
                  </div>
                  {settlement.reversed_at ? (
                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">Đã hoàn tác</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setReversalTargetId(settlement.id); setReversalReason(""); }} className="h-8 rounded-md border border-gray-200 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hoàn tác</button>
                  )}
                </div>
                {reversalTargetId === settlement.id ? (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <label htmlFor={`payroll-reversal-${settlement.id}`} className="form-label-text mb-1 block text-gray-700">Lý do hoàn tác</label>
                    <input id={`payroll-reversal-${settlement.id}`} value={reversalReason} maxLength={500} autoComplete="off" disabled={busy} onChange={(event) => setReversalReason(event.currentTarget.value)} className="form-input-text h-10 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-primary" />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => { setReversalTargetId(null); setReversalReason(""); }} className="h-8 rounded-md border border-gray-200 px-3 text-sm font-medium">Hủy</button>
                      <button type="button" disabled={!reversalReason.trim() || busy} onClick={() => reversalMutation.mutate()} className="h-8 rounded-md bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-50">{reversalMutation.isPending ? <LoadingLabel label="Đang hoàn tác" /> : "Xác nhận"}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {error ? <InlineFormError>{error}</InlineFormError> : null}
      </FormDialogBody>
      <FormDialogFooter right={<><button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg border border-gray-200 px-4 font-medium">Hủy</button><button type="button" disabled={!summary?.balance || busy} onClick={() => settlementMutation.mutate()} className="h-10 rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-50">{settlementMutation.isPending ? <LoadingLabel label="Đang tất toán" /> : "Tất toán"}</button></>} />
    </FormDialogShell>
  );
}
