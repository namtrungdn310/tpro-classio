"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { applyFeeDeadline, previewFeeDeadline, type FeeDeadlineDraft, type FeeDeadlinePreview } from "@/lib/api/billing-dates";
import { getApiErrorMessage } from "@/lib/api/errors";
import { acceptPlan, matchesAcceptedPlan, isUncertainBillingOutcome, type AcceptedPlan } from "@/lib/billing/accepted-plan";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import { formatDate, formatCurrency } from "@/lib/utils/format";

export function FeeDeadlineDialog({ group, onClose, onApplied }: { group: StudentFeeGroup; onClose: () => void; onApplied: () => void }) {
  const records = group.records.filter((fee) => fee.status === "UNPAID" && !fee.paid_amount && !fee.refunded_amount && !fee.paid_date);
  const [feeId, setFeeId] = useState(records[0]?.id ?? "");
  const fee = records.find((row) => row.id === feeId);
  const [due, setDue] = useState<string | null>(fee?.adjusted_due_date ?? fee?.due_date ?? null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const [accepted, setAccepted] = useState<AcceptedPlan<FeeDeadlineDraft & { feeId: string }, FeeDeadlinePreview> | null>(null);
  const draft = { feeId, due_date: due ?? "", reason: reason.trim() };
  const ready = matchesAcceptedPlan(accepted, draft);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const payload = { due_date: draft.due_date, reason: draft.reason };
      if (ready) {
        await applyFeeDeadline(feeId, { ...payload, request_id: accepted.requestId,
          expected_preview_fingerprint: accepted.preview.preview_fingerprint });
        onApplied();
      } else {
        const preview = await previewFeeDeadline(feeId, payload);
        setAccepted(acceptPlan(draft, preview, crypto.randomUUID()));
      }
    } catch (caught) { setError(getApiErrorMessage(caught, "Không thể đổi hạn thu")); if (ready) setUncertain(isUncertainBillingOutcome(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <FormDialogShell title="Đổi hạn thu" subtitle={group.student_name} onClose={onClose} isBusy={busy || uncertain} dirty={reason.trim().length > 0}>
    <FormDialogBody>
      <fieldset disabled={busy || uncertain} className="space-y-3">
        <FormField label="Khoản học phí" controlId="deadline-fee"><select id="deadline-fee" className={formTextControlClassName} value={feeId} onChange={(e) => {
          const record = records.find((item) => item.id === e.target.value);
          setFeeId(e.target.value); setDue(record?.adjusted_due_date ?? record?.due_date ?? null); setAccepted(null);
        }}>{records.map((item) => <option key={item.id} value={item.id}>{item.class_name} · {formatCurrency(item.final_amount)} · {formatDate(item.adjusted_due_date ?? item.due_date)}</option>)}</select></FormField>
        <FormField label="Hạn thu mới" controlId="deadline-date"><ManualDateInput id="deadline-date" value={due} onChange={setDue} /></FormField>
        <FormField label="Lý do" controlId="deadline-reason"><input autoComplete="off" id="deadline-reason" className={formTextControlClassName} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></FormField>
      </fieldset>
      {ready && <section className="space-y-2 rounded-lg border border-gray-200 p-3 text-sm" aria-label="Xem trước hạn thu">
        <p>{formatDate(accepted.preview.previous_due_date)} → {formatDate(accepted.preview.next_due_date)}</p>
        <p className="text-gray-600">Số tiền, kỳ học và lịch thu các kỳ sau giữ nguyên.</p>
        {accepted.preview.already_notified && <p className="text-amber-700">Khoản này đã thông báo. Cần báo lại hạn mới cho phụ huynh.</p>}
        {accepted.preview.becomes_overdue && <p className="text-amber-700">Hạn mới đã qua; khoản thu sẽ hiển thị quá hạn.</p>}
      </section>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <p role="status" className="text-sm text-amber-700">Chưa rõ kết quả lưu. Bấm xác nhận để kiểm tra lại cùng yêu cầu.</p>}
    </FormDialogBody>
    <FormDialogFooter>
      {ready && <Button variant="outline" disabled={busy || uncertain} onClick={() => setAccepted(null)}>Xem lại</Button>}
      <Button variant="outline" disabled={busy || uncertain} onClick={onClose}>Huỷ</Button>
      <Button disabled={busy || !fee || !due || !isValidIsoDate(due) || reason.trim().length < 3} onClick={() => void submit()}>{busy ? "Đang xử lý…" : ready ? "Xác nhận hạn thu" : "Xem trước"}</Button>
    </FormDialogFooter>
  </FormDialogShell>;
}
