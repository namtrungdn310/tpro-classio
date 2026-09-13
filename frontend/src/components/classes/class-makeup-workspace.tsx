"use client";

import { useEffect, useRef, useState } from "react";
import { isDefinitiveSuspensionRejection } from "@/lib/api/suspension-command-recovery";
import { useAuth } from "@/lib/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/lib/api/errors";
import { createClassSuspension, getClassOccurrences, previewClassSuspension } from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import { DataSectionError } from "@/components/ui/data-section-state";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { Button } from "@/components/ui/button";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { ClassSuspensionLifecyclePanel } from "@/components/classes/class-suspension-lifecycle-panel";
import { classSuspensionCreateCommandSchema } from "@/lib/schemas/class";
import type { ClassResponse, MakeupReasonCode } from "@/lib/types";
import { cn } from "@/lib/utils";

type MakeupWorkspaceProps = {
  class_: ClassResponse;
  isSaving: boolean;
  onClose: () => void;
  onPostponed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
};
type Command = Parameters<typeof createClassSuspension>[1];

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addIsoDays(value: string, amount: number) {
  const parsed = new Date(value + "T00:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function displayDate(value: string | null) {
  return value ? value.split("-").reverse().join("/") : "Chưa có kỳ phù hợp";
}

export function ClassMakeupWorkspace(props: MakeupWorkspaceProps) {
  const { user } = useAuth();
  if (!user) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  const pendingKey = `tpro-pending-class-suspension-create:${user.workspace_id}:${user.id}:${props.class_.id}`;
  return <ClassMakeupForm key={pendingKey} {...props} pendingKey={pendingKey} />;
}

function ClassMakeupForm({ class_, isSaving, onClose, onPostponed, onBusyChange, onDirtyChange, pendingKey }: MakeupWorkspaceProps & { pendingKey: string }) {
  const client = useQueryClient();
  const today = todayIso();
  const minimum = class_.start_date && class_.start_date > today ? class_.start_date : today;
  const [from, setFrom] = useState(minimum);
  const [resume, setResume] = useState("");
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState<MakeupReasonCode>("TEACHER_UNAVAILABLE");
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [saved, setSaved] = useState(false);
  const [page, setPage] = useState(0);
  const [manageExisting, setManageExisting] = useState(false);
  const [lifecycleDirty, setLifecycleDirty] = useState(false);
  const request = useRef<Command | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    onDirtyChange?.(lifecycleDirty || (!saved && Boolean(resume || note || from !== minimum || reason !== "TEACHER_UNAVAILABLE")));
    return () => onDirtyChange?.(false);
  }, [lifecycleDirty, saved, resume, note, from, minimum, reason, onDirtyChange]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(pendingKey);
      if (!raw) return;
      const command = classSuspensionCreateCommandSchema.parse(JSON.parse(raw));
      request.current = command;
      setFrom(command.suspended_from); setResume(command.resume_on);
      setReason(command.reason_code); setNote(command.reason_note ?? ""); setUncertain(true);
    } catch { setError("Không đọc được mã xác nhận đang chờ. Hãy kiểm tra lần hoãn đã có trước khi tiếp tục."); setUncertain(true); setRecoveryUnavailable(true); }
  }, [pendingKey]);
  const datesValid = validDate(from) && validDate(resume);
  const days = datesValid ? Math.round((Date.parse(resume) - Date.parse(from)) / 86400000) : 0;
  const dateError = !datesValid ? "Nhập đầy đủ ngày bắt đầu nghỉ và ngày học lại."
    : days <= 0 ? "Ngày học lại phải sau ngày bắt đầu nghỉ."
    : days > 120 ? "Mỗi lần hoãn tối đa 120 ngày, tính từ ngày bắt đầu nghỉ."
    : from < minimum ? "Ngày bắt đầu nghỉ phải từ hôm nay và không trước ngày mở lớp."
    : class_.stopped_on && resume > class_.stopped_on ? "Ngày học lại vượt ngày ngừng lớp."
    : null;
  const valid = !dateError;
  const through = datesValid ? addIsoDays(resume, -1) : resume;
  const occurrences = useQuery({
    queryKey: classQueryKeys.occurrences(class_.id, { from, to: through }),
    queryFn: () => getClassOccurrences(class_.id, from, through),
    enabled: valid && !saved && !uncertain && !manageExisting,
    staleTime: 30_000, retry: false,
  });
  const preview = useQuery({
    queryKey: classQueryKeys.suspensionPreview(class_.id, from, resume),
    queryFn: () => previewClassSuspension(class_.id, { suspended_from: from, resume_on: resume }),
    enabled: valid && !saved && !uncertain && !manageExisting,
    staleTime: 15_000, retry: false,
  });
  const mutation = useMutation({
    mutationFn: (payload: Command) => createClassSuspension(class_.id, payload),
    onSuccess: async () => {
      inFlight.current = false;
      try { sessionStorage.removeItem(pendingKey); } catch { /* confirmed receipt can safely replay */ }
      request.current = null;
      setUncertain(false); setSaved(true); setError(null);
      await Promise.allSettled([
        invalidateDomainQueries(client, { classes: true, students: true, fees: true, reports: true, dashboard: true }),
        ...["class-suspensions", "enrollment-suspensions", "billing-schedule", "attendance", "staff-attendance", "staff-attendance-manual"].map(key =>
          client.invalidateQueries({ queryKey: [key] })),
        Promise.resolve().then(() => onPostponed?.()),
      ]);
    },
    onError: (err) => {
      inFlight.current = false;
      // A timeout/5xx/invalid response may occur after COMMIT. Retry exactly the
      // same command; do not unlock the financial draft until its result is known.
      const definite = isDefinitiveSuspensionRejection(err);
      setUncertain(!definite);
      if (definite) {
        try { sessionStorage.removeItem(pendingKey); } catch { /* rechecking preserves the rejection */ }
        request.current = null; setAccepted(null);
        void preview.refetch(); void occurrences.refetch();
      }
      setError(getApiErrorMessage(err, "Chưa xác định được kết quả. Bấm kiểm tra lại để nhận kết quả của cùng yêu cầu."));
    },
  });
  const locked = isSaving || mutation.isPending || uncertain || saved;
  useEffect(() => {
    onBusyChange?.(mutation.isPending || uncertain);
    return () => onBusyChange?.(false);
  }, [mutation.isPending, uncertain, onBusyChange]);
  const fingerprint = preview.data?.fingerprint;
  const ready = valid && preview.isSuccess && occurrences.isSuccess
    && !preview.isFetching && !occurrences.isFetching
    && !preview.data.blocked_reasons.length && Boolean(fingerprint);

  useEffect(() => { setAccepted(null); setPage(0); }, [from, resume, fingerprint, reason, note]);

  function changeDate(setter: (v: string) => void, value: string | null) {
    setter(value ?? ""); setTouched(false); setError(null); setAccepted(null);
  }
  function submit() {
    if (inFlight.current || mutation.isPending || isSaving || saved) return;
    if (uncertain && request.current) { inFlight.current = true; mutation.mutate(request.current); return; }
    if (!ready || accepted !== fingerprint || !fingerprint) return;
    if (reason === "OTHER" && !note.trim()) {
      setError("Vui lòng ghi rõ lý do hoãn."); return;
    }
    request.current = {
      suspended_from: from, resume_on: resume, reason_code: reason, reason_note: note.trim() || null,
      expected_fingerprint: fingerprint, request_id: crypto.randomUUID(),
    };
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); }
    catch { request.current = null; setError("Trình duyệt không lưu được mã xác nhận. Hãy cho phép bộ nhớ phiên rồi thử lại."); return; }
    setError(null);
    inFlight.current = true;
    mutation.mutate(request.current);
  }
  const members = preview.data?.member_summary ?? [];
  const visibleMembers = members.slice(page * 10, (page + 1) * 10);

  if (manageExisting) return <ClassSuspensionLifecyclePanel classId={class_.id} onBack={() => setManageExisting(false)} onBusyChange={onBusyChange} onDirtyChange={setLifecycleDirty} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex justify-end"><Button type="button" variant="outline" disabled={isSaving || mutation.isPending || uncertain} onClick={() => setManageExisting(true)} className="min-h-11">Điều chỉnh lần hoãn đã có</Button></div>
        <h2 data-workspace-heading tabIndex={-1} className="sr-only">Hoãn lớp — {class_.primary_label}</h2>
        <section aria-label="Hoãn lớp" className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">Bảo lưu ngày nghỉ cho học viên và dời lịch thu tương ứng. Ngày học lại là ngày bắt đầu học bình thường, không tính là ngày nghỉ.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="makeup-range-from" className="form-label-text">Ngày bắt đầu nghỉ</label>
              <ManualDateInput id="makeup-range-from" ariaLabel="Ngày bắt đầu nghỉ" value={from}
                onChange={v => changeDate(setFrom, v)} onBlur={() => setTouched(true)} disabled={locked}
                error={touched && Boolean(dateError)} ariaDescribedBy={touched && dateError ? "makeup-range-error" : undefined} className="mt-1" />
            </div>
            <div>
              <label htmlFor="makeup-range-to" className="form-label-text">Ngày học lại</label>
              <ManualDateInput id="makeup-range-to" ariaLabel="Ngày học lại" value={resume}
                onChange={v => changeDate(setResume, v)} onBlur={() => setTouched(true)} disabled={locked}
                error={touched && Boolean(dateError)} ariaDescribedBy={touched && dateError ? "makeup-range-error" : undefined} className="mt-1" />
            </div>
          </div>
          {touched && dateError ? <p id="makeup-range-error" role="alert" className="mt-2 text-sm text-red-700">{dateError}</p> : null}
          {valid ? <p className="mt-2 text-sm text-gray-600">Nghỉ {days} ngày, từ {displayDate(from)} đến hết {displayDate(through)}.</p> : null}
          {!saved && !uncertain && valid && (preview.isFetching || occurrences.isFetching)
            ? <div className="mt-3" aria-busy="true"><LoadingLabel label="Đang kiểm tra lịch học và ngày thu" /></div> : null}
          {!saved && !uncertain && valid && (preview.isError || occurrences.isError)
            ? <div className="mt-3"><DataSectionError title="Chưa xem được tác động"
                description={getApiErrorMessage(preview.error || occurrences.error, "Vui lòng thử lại.")}
                onRetry={() => { void preview.refetch(); void occurrences.refetch(); }} /></div> : null}
          {valid && preview.isSuccess && !saved ? (
            <div className="mt-4 space-y-3 rounded-lg border border-primary/20 bg-primary-soft/30 p-3 text-sm">
              <p>Hoãn {preview.data.occurrence_count} buổi; {members.length} học viên có ngày nghỉ được bảo lưu.</p>
              <p>Kỳ đầu và khoản đã báo/đã có giao dịch giữ nguyên. Phần bảo lưu chuyển đến kỳ thu phù hợp tiếp theo.</p>
              {preview.data.blocked_reasons.map(message => <p key={message} role="status" className="text-amber-800">{message}</p>)}
              {members.length ? <details>
                <summary className="cursor-pointer py-2 font-medium focus-visible:outline-primary">Xem ngày thu của từng học viên</summary>
                <ul className="divide-y divide-gray-200">
                  {visibleMembers.map(m => <li key={m.enrollment_id} className="py-2">
                    <p className="font-medium">{m.student_name || "Học viên"} · {m.overlap_days} ngày bảo lưu</p>
                    <p>{m.pending_days ? `${m.pending_days} ngày đang chờ kỳ thu phù hợp; chưa dời khoản nào.`
                      : `${displayDate(m.old_due_date)} → ${displayDate(m.new_due_date)}`}</p>
                  </li>)}
                </ul>
                {members.length > 10 ? <div className="flex items-center justify-between gap-2 pt-2">
                  <Button variant="outline" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Trước</Button>
                  <span>Trang {page + 1}/{Math.ceil(members.length / 10)}</span>
                  <Button variant="outline" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * 10 >= members.length}>Sau</Button>
                </div> : null}
              </details> : null}
            </div>
          ) : null}
          <label className="form-label-text mt-4 block">
            <span>Lý do hoãn</span>
            <select value={reason} disabled={locked} onChange={e => setReason(e.target.value as MakeupReasonCode)} className={cn(formTextControlClassName, "mt-1.5 w-full")}>
              <option value="TEACHER_UNAVAILABLE">Giáo viên bận</option>
              <option value="CENTER_OPERATION">Trung tâm điều hành</option>
              <option value="OTHER">Lý do khác</option>
            </select>
          </label>
          <label className="form-label-text mt-3 block">
            <span>Ghi chú{reason === "OTHER" ? " (bắt buộc)" : " (không bắt buộc)"}</span>
            <textarea value={note} disabled={locked} maxLength={500} autoComplete="off" rows={2} onChange={e => setNote(e.target.value)}
              className={cn(formTextControlClassName, "mt-1.5 block h-16 min-h-16 w-full resize-none py-2 leading-5")} />
          </label>
          {ready && !saved ? <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm">
            <input type="checkbox" autoComplete="off" disabled={locked} checked={accepted === fingerprint} onChange={e => setAccepted(e.target.checked ? fingerprint! : null)} className="mt-1" />
            Tôi đã kiểm tra ngày nghỉ, ngày học lại và tác động đến lịch thu.
          </label> : null}
          {uncertain ? <p role="status" className="mt-3 text-sm text-amber-800">Chưa xác định được yêu cầu đã lưu hay chưa. Giữ nguyên thông tin và bấm “Kiểm tra lại kết quả”; hệ thống không tạo thêm lần hoãn.</p> : null}
          {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
          {saved ? <p role="status" className="mt-3 text-sm text-primary">Đã lưu hoãn lớp và cập nhật lịch thu theo tác động đã xác nhận.</p> : null}
        </section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">
        <Button type="button" variant="outline" disabled={mutation.isPending || uncertain} onClick={onClose} className="min-h-11">Đóng</Button>
        {!saved ? <PendingActionButton type="button" isPending={mutation.isPending} pendingLabel="Đang xử lý"
          disabled={isSaving || recoveryUnavailable || (!uncertain && (!ready || accepted !== fingerprint || (reason === "OTHER" && !note.trim())))}
          onClick={submit} className="min-h-11">
          {uncertain ? "Kiểm tra lại kết quả" : "Xác nhận hoãn lớp"}
        </PendingActionButton> : null}
      </div>
    </div>
  );
}
