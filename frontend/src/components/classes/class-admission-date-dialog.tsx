"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter, FormDialogShell } from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { ManualDateInput, isValidIsoDate } from "@/components/ui/manual-date-input";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { previewClassStartDate, updateClassStartDate } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isUncertainBillingOutcome } from "@/lib/billing/accepted-plan";
import type { ClassResponse, ClassStartDatePreview, ClassUpdate } from "@/lib/types";
import { formatDate } from "@/lib/utils/format";

export type ClassAdmissionDateDialogProps = {
  class_: ClassResponse; newStartDate: string; classPatch?: ClassUpdate;
  onApplied: (value: ClassResponse) => void; onClose: () => void;
};

export function ClassAdmissionDateDialog({ class_, newStartDate, classPatch, onApplied, onClose }: ClassAdmissionDateDialogProps) {
  const [preview, setPreview] = useState<ClassStartDatePreview | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const patch = { ...classPatch };
  let financialChange = false;
  for (const key of ["base_fee", "type", "billing_cycle_months", "billing_cycle_weeks"] as const) {
    if (patch[key] !== undefined && patch[key] !== class_[key]) financialChange = true;
    delete patch[key];
  }
  const patchKey = JSON.stringify(patch);
  const draftKey = JSON.stringify({ dates, reason: reason.trim(), patchKey, newStartDate });

  useEffect(() => {
    let active = true;
    if (financialChange) { setError("Vui lòng lưu thay đổi học phí riêng với ngày bắt đầu lớp."); setBusy(false); return; }
    setBusy(true);
    void previewClassStartDate(class_.id, { contract_version: 2, start_date: newStartDate,
      expected_version: class_.version, class_patch: JSON.parse(patchKey) as ClassUpdate,
    }).then((result) => {
      if (!active) return;
      setPreview(result);
      setDates(Object.fromEntries(result.affected_enrollments.map((item) => [item.enrollment_id, item.new_enrollment_date])));
    }).catch((caught) => { if (active) setError(getApiErrorMessage(caught, "Không kiểm tra được ngày bắt đầu lớp")); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [class_.id, class_.version, newStartDate, patchKey, financialChange]);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const payload = { contract_version: 2 as const, start_date: newStartDate, expected_version: class_.version,
        admission_dates: dates, class_patch: patch };
      if (acceptedKey === draftKey && preview?.can_apply && requestId.current) {
        const updated = await updateClassStartDate(class_.id, { ...payload, reason: reason.trim(),
          expected_fingerprint: preview.preview_fingerprint, request_id: requestId.current });
        onApplied(updated); onClose();
      } else {
        const result = await previewClassStartDate(class_.id, payload);
        setPreview(result);
        setAcceptedKey(draftKey); requestId.current = crypto.randomUUID();
      }
    } catch (caught) { setError(getApiErrorMessage(caught, "Không thể cập nhật ngày bắt đầu lớp"));
      if (acceptedKey === draftKey) setUncertain(isUncertainBillingOutcome(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <FormDialogShell title="Ngày bắt đầu lớp" subtitle={class_.name} onClose={onClose} isBusy={busy || uncertain} dirty={reason.trim().length > 0} width="standard">
    <FormDialogBody>
      <p className="text-sm text-gray-700">{formatDate(class_.start_date)} → {formatDate(newStartDate)}</p>
      <p className="text-sm text-gray-500">Lịch thu học phí giữ nguyên.</p>
      {busy && <p role="status" className="text-sm text-gray-500">Đang kiểm tra…</p>}
      {preview?.blocking_reason && <p role="alert" className="text-sm text-destructive">{preview.blocking_reason}</p>}
      <fieldset disabled={busy || uncertain} className="space-y-3">
        {preview?.affected_enrollments.map((item) => <FormField key={item.enrollment_id} label={item.student_name} controlId={`admission-${item.enrollment_id}`}
          hint={`Ngày ghi danh cũ: ${formatDate(item.old_enrollment_date)}`}>
          <ManualDateInput id={`admission-${item.enrollment_id}`} value={dates[item.enrollment_id] ?? null}
            onChange={(value) => setDates((current) => ({ ...current, [item.enrollment_id]: value ?? "" }))} />
        </FormField>)}
        <FormField label="Lý do" controlId="class-admission-reason"><input autoComplete="off" id="class-admission-reason" className={formTextControlClassName} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </fieldset>
      {acceptedKey === draftKey && preview?.can_apply && <p role="status" className="text-sm text-gray-600">Cập nhật ngày lớp và {preview.affected_enrollment_count} ngày ghi danh. Không thay đổi khoản học phí.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <p role="status" className="text-sm text-amber-700">Chưa rõ kết quả lưu. Bấm xác nhận để kiểm tra lại cùng yêu cầu.</p>}
    </FormDialogBody>
    <FormDialogFooter>
      {acceptedKey && <Button variant="outline" disabled={busy || uncertain} onClick={() => setAcceptedKey(null)}>Xem lại</Button>}
      <Button variant="outline" disabled={busy || uncertain} onClick={onClose}>Huỷ</Button>
      <Button disabled={busy || financialChange || !preview || reason.trim().length < 3 || Object.values(dates).some((d) => !isValidIsoDate(d)) || (acceptedKey === draftKey && !preview.can_apply)} onClick={() => void submit()}>
        {acceptedKey === draftKey ? "Xác nhận" : "Kiểm tra thay đổi"}
      </Button>
    </FormDialogFooter>
  </FormDialogShell>;
}
