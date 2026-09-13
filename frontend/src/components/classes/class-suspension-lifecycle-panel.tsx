"use client";
import { useEffect, useRef, useState } from "react";
import { isDefinitiveSuspensionRejection } from "@/lib/api/suspension-command-recovery";
import { useAuth } from "@/lib/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { YearFilterInput } from "@/components/ui/year-filter-input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { formatDate } from "@/lib/utils/format";
import { getApiErrorMessage } from "@/lib/api/errors";
import { invalidateDomainQueries } from "@/lib/query/invalidation";
import { classSuspensionChangeSchema, classSuspensionCommandSchema, listClassPauses, previewClassPauseChange, applyClassPauseChange,
  type ClassPauseRow, type ClassPauseChange, type ClassPauseCommand, type ClassPausePreview } from "@/lib/api/class-suspension-lifecycle";

type Props = {
  classId: string; onBack: () => void; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
};
export function ClassSuspensionLifecyclePanel(props: Props) {
  const { user } = useAuth();
  if (!user) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  const storageKey = `tpro-pending-class-pause:${user.workspace_id}:${user.id}:${props.classId}`;
  return <ClassSuspensionLifecycleForm key={storageKey} {...props} storageKey={storageKey} />;
}

function ClassSuspensionLifecycleForm({ classId, onBack, onBusyChange, onDirtyChange, storageKey: key }: Props & { storageKey: string }) {
  const cache = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClassPauseChange>({ resume_on: "", cancel: false, reason: "" });
  const [preview, setPreview] = useState<ClassPausePreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const operation = useRef(false);
  const pending = useRef<ClassPauseCommand | null>(null);
  const locked = busy || uncertain;
  const list = useQuery({ queryKey: ["class-suspensions", classId, year, offset],
    queryFn: ({ signal }) => listClassPauses(classId, year, offset, signal), retry: false });
  useEffect(() => {
    try { const raw = sessionStorage.getItem(key); if (raw) {
      const command = classSuspensionCommandSchema.parse(JSON.parse(raw)); pending.current = command;
      setSelected(command.adjustment_id); setDraft(classSuspensionChangeSchema.parse(command)); setUncertain(true);
    } } catch { setUncertain(true); setError("Không đọc được mã xác nhận. Hãy mở Báo cáo để đối chiếu trước khi xóa dữ liệu phiên của tab này."); }
  }, [key]);
  useEffect(() => { onBusyChange?.(locked); return () => onBusyChange?.(false); }, [locked, onBusyChange]);
  useEffect(() => { onDirtyChange?.(modified && !saved); return () => onDirtyChange?.(false); }, [modified, saved, onDirtyChange]);
  function choose(row: ClassPauseRow, cancel: boolean) {
    if (locked) return;
    setSelected(row.id); setDraft({ resume_on: row.resume_on, cancel, reason: "" });
    setPreview(null); setAccepted(false); setSaved(false); setError(null);
    setModified(false);
  }
  async function inspect() {
    if (!selected || operation.current) return;
    if (!classSuspensionChangeSchema.safeParse(draft).success) { setError("Nhập đầy đủ ngày học lại và lý do điều chỉnh."); return; }
    operation.current = true; setBusy(true); setError(null); setAccepted(false);
    try { setPreview(await previewClassPauseChange(classId, selected, draft)); }
    catch (err) { setPreview(null); setError(getApiErrorMessage(err, "Chưa xem được tác động. Hãy thử lại.")); }
    finally { operation.current = false; setBusy(false); }
  }
  async function apply() {
    if (operation.current || (uncertain && !pending.current) || (!uncertain && (!selected || !preview || !accepted || preview.blocked_reasons.length))) return;
    const command = pending.current ?? { ...draft, adjustment_id: selected!, request_id: crypto.randomUUID(), expected_fingerprint: preview!.fingerprint };
    try { sessionStorage.setItem(key, JSON.stringify(command)); } catch { setError("Không lưu được mã xác nhận vào tab. Vui lòng cho phép bộ nhớ phiên."); return; }
    pending.current = command; operation.current = true; setBusy(true); setError(null);
    try {
      setPreview(await applyClassPauseChange(classId, command));
      try { sessionStorage.removeItem(key); } catch { /* reloading replays this confirmed command */ }
      pending.current = null;
      setUncertain(false); setSaved(true); setAccepted(false);
      await Promise.allSettled([invalidateDomainQueries(cache, { classes: true, students: true, fees: true, reports: true, dashboard: true }),
        ...["class-suspensions", "enrollment-suspensions", "attendance", "staff-attendance", "staff-attendance-manual", "billing-schedule"].map(k => cache.invalidateQueries({ queryKey: [k] }))]);
    } catch (err) {
      const definite = isDefinitiveSuspensionRejection(err);
      setUncertain(!definite);
      if (definite) { pending.current = null; try { sessionStorage.removeItem(key); } catch { /* replay remains a rejection */ } setPreview(null); setAccepted(false); }
      setError(getApiErrorMessage(err, "Chưa rõ kết quả. Bấm kiểm tra lại cùng yêu cầu."));
    } finally { operation.current = false; setBusy(false); }
  }
  const modify = (change: Partial<ClassPauseChange>) => { setModified(true); setDraft(d => ({ ...d, ...change })); setPreview(null); setAccepted(false); setError(null); };
  return <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <h3 className="text-base font-semibold">Điều chỉnh lần hoãn lớp</h3>
      {error && !selected ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <p className="text-sm text-gray-600">Gia hạn hoặc cho lớp học lại sớm. Khoản đã báo thu/có giao dịch không bị sửa; buổi đã học hoặc có chấm công cần được kiểm tra riêng.</p>
      <label className="flex items-center gap-2 text-sm">Năm<YearFilterInput value={year} disabled={locked} onChange={y => { setYear(y); setOffset(0); }} /></label>
      {list.isPending ? <p role="status">Đang tải các lần hoãn…</p> : list.isError ? <div role="alert"><p>Chưa tải được các lần hoãn.</p><Button type="button" onClick={() => void list.refetch()}>Thử lại</Button></div> : <>
        {!list.data.items.length ? <p className="text-sm">Chưa có lần hoãn lớp trong năm này.</p> : null}
        {list.data.items.map(row => <div key={row.id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <p>Nghỉ {formatDate(row.suspended_from)} · Học lại {formatDate(row.resume_on)}{row.status === "CLOSED" ? " · Đã đóng" : ""}</p>
          {row.status === "OPEN" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked} onClick={() => choose(row, false)} className="min-h-11">Gia hạn / học lại sớm</Button><Button type="button" variant="outline" disabled={locked} onClick={() => choose(row, true)} className="min-h-11">Hủy nhập nhầm</Button></div> : null}
        </div>)}
        {list.data.total > 10 ? <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={locked || !offset} onClick={() => setOffset(v => Math.max(0, v - 10))}>Trước</Button><Button type="button" variant="outline" disabled={locked || offset + 10 >= list.data.total} onClick={() => setOffset(v => v + 10)}>Sau</Button></div> : null}
      </>}
      {selected ? <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h4 className="font-semibold">{draft.cancel ? "Hủy lần hoãn đã chọn" : "Chọn ngày học lại mới"}</h4>
        <label htmlFor="class-pause-new-resume" className="form-label-text block">Ngày học lại</label>
        <ManualDateInput id="class-pause-new-resume" ariaLabel="Ngày học lại mới" value={draft.resume_on} disabled={locked || draft.cancel || saved} onChange={v => modify({ resume_on: v ?? "" })} />
        <div><label className="form-label-text block" htmlFor="class-pause-change-reason">Lý do điều chỉnh</label>
          <textarea id="class-pause-change-reason" autoComplete="off" maxLength={500} value={draft.reason} disabled={locked || saved} onChange={e => modify({ reason: e.target.value })} className={`${formTextControlClassName} mt-1.5 min-h-20 w-full`} /></div>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {saved ? <p role="status" className="text-sm text-green-700">Đã lưu điều chỉnh hoãn lớp.</p> : null}
        {preview ? <div className="space-y-2 text-sm"><p>Khôi phục {preview.restore_count} buổi gốc; hoãn thêm {preview.suspend_count} buổi.</p>
          <details><summary className="min-h-11 cursor-pointer py-2">Tác động đến {preview.member_summary.length} lượt học</summary>
            {preview.member_summary.map(m => <p key={m.enrollment_id} className="border-t border-gray-100 py-2">{m.student_name}: {m.overlap_days > 0 ? "+" : ""}{m.overlap_days} ngày · {m.old_due_date && m.new_due_date ? `${formatDate(m.old_due_date)} → ${formatDate(m.new_due_date)}` : `Chờ bù trừ: ${m.pending_days} ngày`}</p>)}
          </details>
          {preview.blocked_reasons.map(r => <p key={r} role="alert" className="text-red-600">{r}</p>)}
          {!saved && !uncertain && !preview.blocked_reasons.length ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" autoComplete="off" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />Tôi đã kiểm tra và muốn xác nhận.</label> : null}
        </div> : null}
        <div className="flex justify-end gap-2">{uncertain ? <Button type="button" disabled={busy} onClick={() => void apply()} className="min-h-11">{busy ? "Đang kiểm tra…" : "Kiểm tra kết quả"}</Button>
          : !saved ? <><Button type="button" variant="outline" disabled={busy} onClick={() => void inspect()} className="min-h-11">Xem tác động</Button><Button type="button" disabled={busy || !accepted || !preview || Boolean(preview.blocked_reasons.length)} onClick={() => void apply()} className="min-h-11">{busy ? "Đang lưu…" : "Xác nhận"}</Button></> : null}</div>
      </section> : null}
    </div>
    <div className="border-t border-gray-200 bg-white p-3"><Button type="button" variant="outline" disabled={locked} onClick={() => { if (modified && !saved) setConfirmBack(true); else onBack(); }} className="min-h-11">Quay lại tạo lần hoãn</Button></div>
    <ConfirmationDialog open={confirmBack} title="Bỏ điều chỉnh chưa lưu?" description="Lần hoãn đã lưu vẫn giữ nguyên. Chỉ nội dung bạn đang nhập sẽ bị bỏ."
      confirmLabel="Bỏ điều chỉnh" cancelLabel="Tiếp tục chỉnh sửa" tone="danger" onCancel={() => setConfirmBack(false)} onConfirm={onBack} />
  </div>;
}
