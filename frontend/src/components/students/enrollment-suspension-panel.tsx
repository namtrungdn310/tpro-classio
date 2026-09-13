"use client";

import { useEffect, useRef, useState } from "react";
import { isDefinitiveSuspensionRejection } from "@/lib/api/suspension-command-recovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import { FormField } from "@/components/ui/form-field";
import { FormDialogBody, FormDialogFooter } from "@/components/ui/form-dialog-shell";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { YearFilterInput } from "@/components/ui/year-filter-input";
import { formTextControlClassName, formTextControlErrorClassName } from "@/components/ui/form-text-control";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import { useAuth } from "@/lib/hooks/useAuth";
import { formatDate } from "@/lib/utils/format";
import {
  previewIndividualSuspension, applyIndividualSuspension, listIndividualSuspensions,
  suspensionDraftSchema, suspensionCommandSchema,
  type SuspensionDraft, type SuspensionCommand, type IndividualSuspensionPreview, type IndividualSuspensionRow,
} from "@/lib/api/enrollment-suspensions";

type Props = {
  enrollmentId: string;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNestedOverlayChange?: (open: boolean) => void;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const initialDraft = (): SuspensionDraft => ({ suspension_id: null, action: "SAVE", suspended_from: today(), resume_on: "", reason: "" });

export function EnrollmentSuspensionPanel(props: Props) {
  const { user } = useAuth();
  if (!user) return <p role="status"><LoadingLabel label="Đang kiểm tra phiên đăng nhập" /></p>;
  const storageKey = `tpro-pending-suspension:${user.workspace_id}:${user.id}:${props.enrollmentId}`;
  return <EnrollmentSuspensionForm key={storageKey} {...props} storageKey={storageKey} />;
}

function EnrollmentSuspensionForm({ enrollmentId, onBusyChange, onDirtyChange, onNestedOverlayChange, storageKey }: Props & { storageKey: string }) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<SuspensionDraft>(initialDraft);
  const [preview, setPreview] = useState<IndividualSuspensionPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);
  const [reasonRequired, setReasonRequired] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<SuspensionDraft | null>(null);
  const [pendingAction, setPendingAction] = useState<"preview" | "create" | "apply" | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const [year, setYear] = useState(() => Number(today().slice(0, 4)));
  const [offset, setOffset] = useState(0);
  const commandRef = useRef<SuspensionCommand | null>(null);
  const operation = useRef(false);
  const list = useQuery({
    queryKey: ["enrollment-suspensions", enrollmentId, year, offset],
    queryFn: ({ signal }) => listIndividualSuspensions(enrollmentId, year, offset, signal), retry: false,
  });
  const parsed = suspensionDraftSchema.safeParse(draft);
  const days = parsed.success ? (Date.parse(draft.resume_on) - Date.parse(draft.suspended_from)) / 86400000 : 0;
  const valid = parsed.success && days > 0 && days <= 120;
  const locked = busy || uncertain;
  const dirty = !saved && Boolean(draft.resume_on || draft.reason || draft.suspension_id || draft.suspended_from !== today());
  const fromError = touched && !isValidIsoDate(draft.suspended_from) ? "Nhập ngày bắt đầu nghỉ hợp lệ." : undefined;
  const resumeError = touched && !isValidIsoDate(draft.resume_on) ? "Nhập ngày học lại hợp lệ."
    : touched && !fromError && !valid ? "Ngày học lại phải sau ngày bắt đầu nghỉ, tối đa 120 ngày." : undefined;
  const reasonError = reasonRequired && !draft.reason.trim() ? "Nhập lý do trước khi xác nhận lưu." : undefined;

  useEffect(() => {
    // Restore only this user's membership command. Reload must not create a
    // second financial operation when the first response was lost.
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const command = suspensionCommandSchema.parse(JSON.parse(raw));
        commandRef.current = command;
        setDraft(suspensionDraftSchema.parse(command)); setUncertain(true);
      }
    } catch { setUncertain(true); setRecoveryUnavailable(true); setError("Không đọc được yêu cầu đang chờ. Hãy mở Báo cáo để đối chiếu lần hoãn trước khi xóa dữ liệu phiên của tab này."); }
  }, [storageKey]);
  useEffect(() => { onBusyChange(locked); return () => onBusyChange(false); }, [locked, onBusyChange]);
  useEffect(() => {
    onNestedOverlayChange?.(Boolean(pendingDraft));
    return () => onNestedOverlayChange?.(false);
  }, [pendingDraft, onNestedOverlayChange]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (locked) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);

  function change(next: Partial<SuspensionDraft>) {
    if (locked) return;
    setDraft(d => ({ ...d, ...next }));
    // Notes do not change the financial calculation already reviewed.
    if (Object.keys(next).some(key => key !== "reason")) { setPreview(null); setAccepted(false); }
    setSaved(false); setError(null); setTouched(false); setReasonRequired(false);
  }
  function replaceDraft(next: SuspensionDraft) {
    change(next);
    formRef.current?.scrollIntoView({ block: "start" });
  }
  function requestDraft(next: SuspensionDraft) {
    if (locked) return;
    if (dirty) setPendingDraft(next);
    else replaceDraft(next);
  }
  function selectPause(row: IndividualSuspensionRow, action: "SAVE" | "CANCEL") {
    requestDraft({ suspension_id: row.id, action, suspended_from: row.suspended_from, resume_on: row.resume_on, reason: "" });
  }
  async function inspect(action: "preview" | "create" = "preview") {
    setTouched(true);
    if (!valid || operation.current) return;
    operation.current = true; setBusy(true); setPendingAction(action); setError(null); setAccepted(false);
    try { setPreview(await previewIndividualSuspension(enrollmentId, draft)); }
    catch (err) { setPreview(null); setError(getApiErrorMessage(err, "Chưa xem được tác động. Vui lòng thử lại.")); }
    finally { operation.current = false; setBusy(false); setPendingAction(null); }
  }
  async function apply() {
    if (operation.current || (uncertain && !commandRef.current) || (!uncertain && (!preview || !accepted))) return;
    if (!uncertain && !draft.reason.trim()) {
      setReasonRequired(true); reasonRef.current?.focus(); return;
    }
    operation.current = true; setBusy(true); setPendingAction("apply"); setError(null);
    const command = commandRef.current ?? { ...draft, request_id: crypto.randomUUID(), expected_fingerprint: preview!.fingerprint };
    commandRef.current = command;
    try {
      // Fail before sending if the browser cannot retain a recovery receipt.
      sessionStorage.setItem(storageKey, JSON.stringify(command));
    } catch {
      setError("Trình duyệt không lưu được mã xác nhận. Hãy cho phép bộ nhớ phiên rồi thử lại.");
      operation.current = false; setBusy(false); setPendingAction(null); if (!uncertain) commandRef.current = null; return;
    }
    try {
      const result = await applyIndividualSuspension(enrollmentId, command);
      // A local cleanup/cache failure is not an ambiguous backend commit.
      try { sessionStorage.removeItem(storageKey); } catch { /* replay remains safe */ }
      commandRef.current = null;
      setUncertain(false); setSaved(true); setPreview(result); setAccepted(false);
      await Promise.allSettled([
        cache.invalidateQueries({ queryKey: ["enrollment-suspensions"] }),
        cache.invalidateQueries({ queryKey: ["billing-schedule"] }),
        invalidateDomainQueries(cache, { classes: true, students: true, fees: true, reports: true, dashboard: true }),
      ]);
    } catch (err) {
      const definitive = isDefinitiveSuspensionRejection(err);
      setUncertain(!definitive);
      if (definitive) { try { sessionStorage.removeItem(storageKey); } catch { /* definitive rejection can be rechecked */ } commandRef.current = null; setPreview(null); setAccepted(false); }
      setError(getApiErrorMessage(err, "Chưa rõ kết quả. Kiểm tra lại cùng yêu cầu; không tạo lần hoãn mới."));
    } finally { operation.current = false; setBusy(false); setPendingAction(null); }
  }

  return <>
    <FormDialogBody>
    <section ref={formRef} className="space-y-3">
      <h3 className="form-section-title-text" data-workspace-heading tabIndex={-1}>{draft.action === "CANCEL" ? "Hủy lần tạm nghỉ nhập nhầm" : draft.suspension_id ? "Điều chỉnh ngày học lại" : "Thời gian tạm nghỉ"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField controlId="individual-pause-from" label="Ngày bắt đầu nghỉ" error={fromError}>
          <ManualDateInput id="individual-pause-from" ariaLabel="Ngày bắt đầu nghỉ" error={Boolean(fromError)} ariaDescribedBy={fromError ? "individual-pause-from-error" : undefined} value={draft.suspended_from} disabled={locked || saved || Boolean(draft.suspension_id)} onChange={v => change({ suspended_from: v ?? "" })} /></FormField>
        <FormField controlId="individual-pause-resume" label="Ngày học lại" error={resumeError}>
          <ManualDateInput id="individual-pause-resume" ariaLabel="Ngày học lại" error={Boolean(resumeError)} ariaDescribedBy={resumeError ? "individual-pause-resume-error" : undefined} value={draft.resume_on} disabled={locked || saved || draft.action === "CANCEL"} onChange={v => change({ resume_on: v ?? "" })} /></FormField>
      </div>
      <p className="helper-text text-gray-500">Tối đa 120 ngày mỗi lần.</p>
      <FormField controlId="individual-pause-reason" label="Lý do tạm nghỉ hoặc điều chỉnh" error={reasonError} hint="Chỉ bắt buộc khi xác nhận lưu; có thể xem tác động trước.">
        <textarea ref={reasonRef} id="individual-pause-reason" autoComplete="off" rows={3} value={draft.reason} maxLength={500} disabled={locked || saved} aria-invalid={Boolean(reasonError) || undefined} aria-describedby={reasonError ? "individual-pause-reason-error" : undefined} onChange={e => change({ reason: e.target.value })} className={cn(formTextControlClassName, "scrollbar-hidden h-auto min-h-20 resize-none py-2", reasonError && formTextControlErrorClassName)} /></FormField>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {uncertain ? <p role="status" className="text-sm text-amber-800">Yêu cầu có thể đã được lưu. Bấm kiểm tra kết quả để nhận lại đúng lần xác nhận đó.</p> : null}
      {saved ? <p role="status" className="text-sm text-green-700">Đã lưu và cập nhật ngày bảo lưu.</p> : null}
      {preview ? <div className="workspace-panel-in space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
        <p>Tổng ngày bảo lưu của lượt học: {preview.previous_preserved_days} → {preview.preserved_days} ngày.</p>
        <p>Lần này: {preview.delta_days > 0 ? "+" : ""}{preview.delta_days} ngày{preview.overlap_or_waived_days ? `; ${preview.overlap_or_waived_days} ngày trùng hoặc đã miễn thu không tính thêm` : ""}.</p>
        {preview.old_due_date && preview.new_due_date ? <p>Ngày thu kỳ được điều chỉnh: {formatDate(preview.old_due_date)} → {formatDate(preview.new_due_date)}.</p> : null}
        {preview.pending_days !== 0 ? <p>Chờ bù trừ vào kỳ phù hợp: {preview.pending_days} ngày.</p> : null}
        {preview.warnings.map(w => <p key={w}>{w}</p>)}
        {!saved && !uncertain ? <label className="flex cursor-pointer items-start gap-2 py-1"><input className="mt-1 accent-primary" type="checkbox" autoComplete="off" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />Tôi đã kiểm tra tác động và muốn xác nhận.</label> : null}
      </div> : null}
    </section>
    <section className="space-y-3 border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between gap-3"><h3 className="form-section-title-text">Các lần tạm nghỉ</h3>
        <label className="flex items-center gap-2 text-sm">Năm<YearFilterInput value={year} disabled={locked} onChange={v => { setYear(v); setOffset(0); }} /></label></div>
      {list.isPending ? <p role="status"><LoadingLabel label="Đang tải các lần tạm nghỉ" /></p> : list.isError ? <div role="alert"><p>Chưa tải được các lần tạm nghỉ.</p><PendingActionButton type="button" variant="outline" isPending={list.isFetching} pendingLabel="Đang tải" onClick={() => void list.refetch()}>Thử lại</PendingActionButton></div> : <>
        {list.data.pending_days !== 0 ? <p className="text-sm text-amber-800">Toàn lượt học còn {list.data.pending_days} ngày chờ bù trừ vào lịch thu.</p> : null}
        {!list.data.items.length ? <p className="text-sm text-gray-600">Chưa có lần tạm nghỉ trong năm này.</p> : null}
        {list.data.items.map(row => <div key={row.id} className="border-t border-gray-100 pt-3 text-sm">
          <p className="font-medium">Nghỉ {formatDate(row.suspended_from)} · Học lại {formatDate(row.resume_on)}{row.status === "CANCELLED" ? " · Đã hủy" : ""}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-gray-600">{row.reason}</p>
          {row.status !== "CANCELLED" ? <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={locked} onClick={() => selectPause(row, "SAVE")}>Gia hạn / học lại sớm</Button>
            <Button type="button" variant="outline" disabled={locked} onClick={() => selectPause(row, "CANCEL")}>Hủy nhập nhầm</Button>
          </div> : null}
        </div>)}
        {list.data.total > 10 ? <div className="flex items-center justify-end gap-2 text-sm"><Button type="button" variant="outline" disabled={locked || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 10))}>Trước</Button><span>{offset + 1}–{Math.min(offset + 10, list.data.total)} / {list.data.total}</span><Button type="button" variant="outline" disabled={locked || offset + 10 >= list.data.total} onClick={() => setOffset(v => v + 10)}>Sau</Button></div> : null}
      </>}
    </section>
    </FormDialogBody>
    <FormDialogFooter className="flex-wrap [&>div:last-child]:shrink [&>div:last-child]:flex-wrap" right={<>
      {uncertain ? <PendingActionButton type="button" disabled={recoveryUnavailable} isPending={busy} pendingLabel="Đang kiểm tra" onClick={() => void apply()}>Kiểm tra kết quả</PendingActionButton>
        : saved ? <Button type="button" onClick={() => requestDraft(initialDraft())}>Tạo lần tạm nghỉ mới</Button>
        : <>
          {draft.suspension_id ? <Button type="button" variant="outline" disabled={busy} onClick={() => requestDraft(initialDraft())}>Quay lại</Button> : null}
          {!preview ? <PendingActionButton type="button" variant="outline" disabled={busy} isPending={pendingAction === "preview"} pendingLabel="Đang xem" onClick={() => void inspect()}>Xem tác động</PendingActionButton> : null}
          <PendingActionButton type="button" disabled={busy || Boolean(preview && !accepted)} isPending={pendingAction === "create" || pendingAction === "apply"} pendingLabel={pendingAction === "apply" ? "Đang lưu" : "Đang kiểm tra"} onClick={() => void (preview ? apply() : inspect("create"))}>
            {preview ? "Xác nhận" : draft.action === "CANCEL" ? "Hủy lần tạm nghỉ" : draft.suspension_id ? "Lưu điều chỉnh" : "Tạo lần tạm nghỉ"}
          </PendingActionButton>
        </>}
    </>} />
    {pendingDraft ? <ConfirmationDialog open title="Bỏ thay đổi chưa lưu?" description="Thời gian và lý do đang nhập sẽ không được lưu." confirmLabel="Bỏ thay đổi" cancelLabel="Tiếp tục chỉnh sửa" tone="danger" onCancel={() => setPendingDraft(null)} onConfirm={() => { replaceDraft(pendingDraft); setPendingDraft(null); }} /> : null}
  </>;
}
