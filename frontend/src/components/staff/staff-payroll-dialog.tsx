"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { FormSection } from "@/components/ui/form-section";
import { InlineFormError } from "@/components/ui/inline-form-error";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { ExcelExportButton } from "@/components/ui/excel-export-button";
import { SmartMoneyInput } from "@/components/ui/smart-money-input";
import { ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { createManualAttendance, createStaffCompensationRate, getManualAttendanceTargets, getStaffAttendanceHistory, getStaffPayroll, reverseAttendance, reverseStaffPayrollSettlement, settleStaffPayroll, type ManualAttendanceTarget } from "@/lib/api/staff";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getBankAccounts } from "@/lib/api/banking";
import { exportStaffPayroll } from "@/lib/staff/export";
import { useToast } from "@/components/providers/toast-provider";

const money = new Intl.NumberFormat("vi-VN");

export function StaffPayrollDialog({
  staffId,
  staffName,
  onClose,
}: {
  staffId: string;
  staffName: string;
  onClose: () => void;
}) {
  return (
    <FormDialogShell
      title="Thù lao nhân sự"
      subtitle={staffName}
      width="sm"
      onClose={onClose}
    >
      <StaffPayrollContent
        staffId={staffId}
        staffName={staffName}
        onClose={onClose}
      />
    </FormDialogShell>
  );
}

export function StaffPayrollContent({
  staffId,
  staffName,
  onClose,
}: {
  staffId: string;
  staffName: string;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const notify = useToast();
  const key = ["staff-payroll", staffId] as const;
  const payroll = useQuery({ queryKey: key, queryFn: () => getStaffPayroll(staffId) });
  const attendanceHistory = useQuery({
    queryKey: ["staff-attendance", staffId] as const,
    queryFn: () => getStaffAttendanceHistory(staffId),
    // Keep the dialog responsive when an admin reopens it while reviewing
    // several staff members; mutations below invalidate this immediately.
    staleTime: 15_000,
  });
  const manualTargets = useQuery({
    queryKey: ["staff-attendance-manual", staffId] as const,
    queryFn: () => getManualAttendanceTargets(staffId),
    enabled: false,
    staleTime: 10_000,
  });
  const bankAccountsQuery = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: getBankAccounts,
  });
  const activeBankAccounts = useMemo(
    () => bankAccountsQuery.data?.accounts.filter((account) => account.is_active) ?? [],
    [bankAccountsQuery.data?.accounts],
  );
  const [rate, setRate] = useState<number | null>(null);
  const [assignmentRole, setAssignmentRole] = useState<"TEACHER" | "ASSISTANT" | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(() => getTodayInputValue());
  const [method, setMethod] = useState<"bank_transfer" | "cash">("bank_transfer");
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [error, setError] = useState("");
  const [reversalTargetId, setReversalTargetId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTarget, setManualTarget] = useState<ManualAttendanceTarget | null>(null);
  const [attendanceReverseTarget, setAttendanceReverseTarget] = useState<{
    attendanceId: string;
    className: string;
  } | null>(null);
  const [attendanceReverseReason, setAttendanceReverseReason] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  useEffect(() => {
    if (method !== "bank_transfer") return;
    if (activeBankAccounts.some((account) => account.id === settlementAccountId)) return;
    setSettlementAccountId(
      activeBankAccounts.find((account) => account.is_default)?.id ??
        activeBankAccounts[0]?.id ??
        "",
    );
  }, [activeBankAccounts, method, settlementAccountId]);
  const rateMutation = useMutation({
    mutationFn: () =>
      createStaffCompensationRate(staffId, {
        rate_amount: rate ?? 0,
        effective_from: effectiveFrom ?? "",
        assignment_role: assignmentRole,
      }),
    onSuccess: async () => { setRate(null); setError(""); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể lưu mức thù lao.")),
  });
  const settlementMutation = useMutation({
    mutationFn: () =>
      settleStaffPayroll(staffId, {
        request_id: crypto.randomUUID(),
        method,
        settlement_account_id:
          method === "bank_transfer" ? settlementAccountId : null,
      }),
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
  const manualCheckInMutation = useMutation({
    mutationFn: (target: ManualAttendanceTarget) =>
      createManualAttendance(staffId, {
        occurrence_id: target.occurrence_id,
        request_id: crypto.randomUUID(),
        reason: "Chấm công thủ công bởi quản lý",
      }),
    onSuccess: async () => {
      setError(""); setManualTarget(null); setManualOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ["staff-attendance", staffId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-attendance-manual", staffId] }),
      ]);
    },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể chấm công thủ công.")),
  });
  const attendanceReversalMutation = useMutation({
    mutationFn: () =>
      reverseAttendance(staffId, attendanceReverseTarget?.attendanceId ?? "", {
        request_id: crypto.randomUUID(),
        reason: attendanceReverseReason.trim() || "Huỷ chấm công thủ công",
      }),
    onSuccess: async () => {
      setError(""); setAttendanceReverseTarget(null); setAttendanceReverseReason("");
      await queryClient.invalidateQueries({ queryKey: ["staff-attendance", staffId] });
    },
    onError: (cause) => setError(getApiErrorMessage(cause, "Không thể huỷ chấm công.")),
  });
  const busy = rateMutation.isPending || settlementMutation.isPending || reversalMutation.isPending || manualCheckInMutation.isPending || attendanceReversalMutation.isPending;
  const summary = payroll.data;

  async function handleExport() {
    if (!summary || !attendanceHistory.data || isExporting) return;
    setIsExporting(true);
    try {
      await exportStaffPayroll(staffName, summary, attendanceHistory.data);
      notify.success("Đã xuất danh sách chấm công và lịch sử tất toán ra file Excel.");
    } catch {
      notify.error("Không thể xuất dữ liệu thù lao. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <FormDialogBody className="space-y-3">
        {payroll.isError ? <InlineFormError action={<button type="button" className="text-sm font-semibold underline" onClick={() => void payroll.refetch()}>Thử lại</button>}>Không tải được dữ liệu thù lao.</InlineFormError> : null}
        <FormSection
          label="Thiết lập thù lao"
          order={1}
          summary={
            summary?.rates && summary.rates.length > 0
              ? `${summary.rates.length} mức thù lao`
              : "Chưa thiết lập"
          }
        >
          <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-3">
            <p className="form-label-text text-gray-600">Cần thanh toán</p>
            <p className="mt-0.5 text-2xl font-semibold leading-8 tabular-nums text-gray-950">
              {money.format(summary?.balance ?? 0)}đ
            </p>
          </div>
          {summary?.rates && summary.rates.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/70 p-3 text-xs">
              <p className="font-semibold text-gray-700">Mức thù lao đang áp dụng:</p>
              <div className="flex flex-wrap gap-2">
                {summary.rates.map((r) => {
                  const roleText =
                    r.assignment_role === "TEACHER"
                      ? "Khi làm giáo viên"
                      : r.assignment_role === "ASSISTANT"
                        ? "Khi làm trợ giảng"
                        : "Mức mặc định";
                  return (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-800"
                    >
                      <span className="text-gray-500">{roleText}:</span>
                      <span className="font-semibold text-primary">{money.format(r.rate_amount)}đ</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
            <FormField label="Mức lương từng buổi">
              <SmartMoneyInput
                value={rate}
                onChange={setRate}
                placeholder="Nhập số tiền"
                disabled={busy}
                className={formTextControlClassName}
              />
            </FormField>
            <FormField label="Vai trò áp dụng" labelId="payroll-role-select">
              <SegmentedControl
                ariaLabelledBy="payroll-role-select"
                selected={assignmentRole ?? "ALL"}
                onSelect={(value) =>
                  setAssignmentRole(value === "ALL" ? null : (value as "TEACHER" | "ASSISTANT"))
                }
                options={[
                  { value: "ALL", label: "Mặc định" },
                  { value: "TEACHER", label: "GV" },
                  { value: "ASSISTANT", label: "TG" },
                ]}
              />
            </FormField>
            <FormField label="Áp dụng từ">
              <ManualDateInput
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                disabled={busy}
                ariaLabel="Ngày bắt đầu áp dụng mức thù lao"
              />
            </FormField>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!rate || !isValidIsoDate(effectiveFrom ?? "") || busy}
              onClick={() => rateMutation.mutate()}
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rateMutation.isPending ? <LoadingLabel label="Đang lưu" /> : "Lưu mức thù lao"}
            </button>
          </div>
        </FormSection>
        <FormSection label="Thanh toán thù lao" order={2}>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <FormField label="Hình thức" labelId="payroll-settlement-method">
              <SegmentedControl ariaLabelledBy="payroll-settlement-method" selected={method} onSelect={(value) => setMethod(value as typeof method)} options={[{ value: "bank_transfer", label: "Chuyển khoản" }, { value: "cash", label: "Tiền mặt" }]} />
            </FormField>
            {method === "bank_transfer" ? (
              <FormField label="Tài khoản dùng để tất toán">
              <select
                value={settlementAccountId}
                disabled={busy || bankAccountsQuery.isPending}
                onChange={(event) => setSettlementAccountId(event.currentTarget.value)}
                className={formTextControlClassName}
              >
                <option value="">Chọn tài khoản ngân hàng</option>
                {activeBankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} · {account.label} · ****
                    {account.account_number.slice(-4)}
                  </option>
                ))}
              </select>
              {bankAccountsQuery.isError ? (
                <span role="alert" className="helper-text mt-1.5 block select-none text-destructive">
                  Không tải được tài khoản ngân hàng. Hãy thử lại trước khi tất toán.
                </span>
              ) : activeBankAccounts.length === 0 ? (
                <span className="helper-text mt-1.5 block select-none text-amber-700">
                  Chưa có tài khoản. Hãy thêm tại trang Ngân hàng trước khi tất toán.
                </span>
              ) : (
                <span className="helper-text mt-1.5 block select-none text-gray-500">
                  Chọn tài khoản thực tế dùng để chuyển thù lao cho nhân sự.
                </span>
              )}
              </FormField>
            ) : (
              <div className="hidden sm:block" aria-hidden="true" />
            )}
          </div>
        </FormSection>
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
                    {settlement.method === "bank_transfer" && settlement.settlement_bank_name ? (
                      <p className="helper-text mt-1 text-gray-500">
                        {settlement.settlement_bank_name} · ****
                        {settlement.settlement_account_number?.slice(-4) ?? "—"}
                      </p>
                    ) : null}
                  </div>
                  {settlement.reversed_at ? (
                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">Đã hoàn tác</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setReversalTargetId(settlement.id); setReversalReason(""); }} className="h-8 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hoàn tác</button>
                  )}
                </div>
                {reversalTargetId === settlement.id ? (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <label htmlFor={`payroll-reversal-${settlement.id}`} className="block">
                      <span className="form-label-text mb-1.5 block text-gray-700">Lý do hoàn tác</span>
                      <input
                        id={`payroll-reversal-${settlement.id}`}
                        value={reversalReason}
                        maxLength={500}
                        autoComplete={savedInfoAutocomplete.disabled}
                        disabled={busy}
                        onChange={(event) => setReversalReason(event.currentTarget.value)}
                        placeholder="Nhập lý do hoàn tác..."
                        className={formTextControlClassName}
                      />
                    </label>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => { setReversalTargetId(null); setReversalReason(""); }} className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hủy</button>
                      <PendingActionButton type="button" isPending={reversalMutation.isPending} pendingLabel="Đang hoàn tác" disabled={!reversalReason.trim() || rateMutation.isPending || settlementMutation.isPending} onClick={() => reversalMutation.mutate()} className="h-8 rounded-md bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-50">Xác nhận</PendingActionButton>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        <section className="space-y-2 border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-900">Lịch sử chấm công</h3>
            <div className="flex items-center gap-2">
              {attendanceHistory.isFetching && attendanceHistory.data ? (
                <LoadingLabel label="Đang tải" />
              ) : null}
              <ExcelExportButton
                disabled={!summary || !attendanceHistory.data}
                isExporting={isExporting}
                onClick={() => void handleExport()}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setManualOpen((open) => !open);
                  if (!manualTargets.data) {
                    void manualTargets.refetch();
                  }
                }}
                className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                Chấm công thủ công
              </button>
            </div>
          </div>

          {manualOpen ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-sm font-medium text-gray-700">
                Chọn buổi chưa chấm của nhân sự để chấm thủ công
              </p>
              {manualTargets.isPending ? (
                <div className="flex min-h-10 items-center text-sm text-gray-500">
                  <LoadingLabel label="Đang tải các buổi chưa chấm" />
                </div>
              ) : manualTargets.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Không tải được danh sách buổi.
                </p>
              ) : (manualTargets.data ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">Không còn buổi nào chưa chấm công.</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {(manualTargets.data ?? []).map((target) => (
                    <li key={target.occurrence_id} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">
                          {target.class_name}
                          <span className="ml-1.5 text-xs font-normal text-gray-400">
                            {target.role === "TEACHER" ? "GV" : "TG"}
                          </span>
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(target.occurrence_start_at).toLocaleString("vi-VN")}
                          {target.kind === "MAKEUP" ? " · Buổi bù" : ""}
                          {target.rate_amount !== null ? ` · ${money.format(target.rate_amount)}đ` : ""}
                        </p>
                      </div>
                      <PendingActionButton
                        type="button"
                        isPending={manualCheckInMutation.isPending && manualTarget?.occurrence_id === target.occurrence_id}
                        pendingLabel="Đang chấm"
                        disabled={busy}
                        onClick={() => {
                          setManualTarget(target);
                          manualCheckInMutation.mutate(target);
                        }}
                        className="h-8 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Chấm
                      </PendingActionButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {attendanceHistory.isPending ? (
            <div className="flex min-h-14 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
              <LoadingLabel label="Đang tải lịch sử chấm công" />
            </div>
          ) : attendanceHistory.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Không tải được lịch sử chấm công.
            </p>
          ) : attendanceHistory.data?.items.length ? (
            <ul className="divide-y divide-gray-100">
              {attendanceHistory.data.items.map((item) => (
                <li key={item.attendance_id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800">
                        {item.class_name ?? "Lớp đã đóng"}
                        <span className="ml-1.5 text-xs font-normal text-gray-400">
                          {item.role === "TEACHER" ? "GV" : "TG"}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(item.occurrence_start_at).toLocaleString("vi-VN")}
                        {item.kind === "MAKEUP" ? " · Buổi bù" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-gray-900">{money.format(item.rate_amount)}đ</p>
                        <p className="text-xs text-gray-400">
                          Chấm lúc {new Date(item.checkin_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {item.reversed_at ? (
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">Đã huỷ</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setAttendanceReverseTarget({
                              attendanceId: item.attendance_id,
                              className: item.class_name ?? "buổi học này",
                            })
                          }
                          className="h-8 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Huỷ
                        </button>
                      )}
                    </div>
                  </div>
                  {attendanceReverseTarget?.attendanceId === item.attendance_id ? (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <p className="text-xs text-gray-600">
                        Huỷ lần chấm công {attendanceReverseTarget.className} sẽ ghi bút toán đối ứng (REVERSAL) và trừ ra khỏi thù lao.
                      </p>
                      <label htmlFor={`att-reverse-${item.attendance_id}`} className="mt-2 block">
                        <span className="form-label-text mb-1.5 block text-gray-700">Lý do huỷ</span>
                        <input
                          id={`att-reverse-${item.attendance_id}`}
                          value={attendanceReverseReason}
                          maxLength={500}
                          autoComplete={savedInfoAutocomplete.disabled}
                          disabled={busy}
                          onChange={(event) => setAttendanceReverseReason(event.currentTarget.value)}
                          placeholder="Chấm nhầm ngày/giờ..."
                          className={formTextControlClassName}
                        />
                      </label>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setAttendanceReverseTarget(null); setAttendanceReverseReason(""); }}
                          className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Hủy
                        </button>
                        <PendingActionButton
                          type="button"
                          isPending={attendanceReversalMutation.isPending}
                          pendingLabel="Đang huỷ"
                          disabled={busy}
                          onClick={() => attendanceReversalMutation.mutate()}
                          className="h-8 rounded-md bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Xác nhận huỷ
                        </PendingActionButton>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Chưa có buổi chấm công nào.</p>
          )}
        </section>
        {error ? <InlineFormError>{error}</InlineFormError> : null}
      </FormDialogBody>
      <FormDialogFooter right={<><button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hủy</button><PendingActionButton type="button" isPending={settlementMutation.isPending} pendingLabel="Đang tất toán" disabled={!summary?.balance || rateMutation.isPending || reversalMutation.isPending || bankAccountsQuery.isPending || (method === "bank_transfer" && !settlementAccountId)} onClick={() => settlementMutation.mutate()} className="h-8 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Tất toán</PendingActionButton></>} />
    </div>
  );
}

function getTodayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
