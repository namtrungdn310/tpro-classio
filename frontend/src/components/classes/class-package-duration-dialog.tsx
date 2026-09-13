"use client";

import { useState } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { FormNotice } from "@/components/ui/form-notice";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  previewClassBillingCycle,
  updateClassBillingCycle,
} from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import type { ClassBillingCyclePreview, ClassResponse } from "@/lib/types";
import { formatDate } from "@/lib/utils/format";

type Props = {
  class_: ClassResponse;
  onApplied: (class_: ClassResponse) => void;
  onClose: () => void;
};

export function ClassPackageDurationDialog({ class_, onApplied, onClose }: Props) {
  const notify = useToast();
  const [weeks, setWeeks] = useState<number | null>(class_.billing_cycle_weeks ?? null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ClassBillingCyclePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const validWeeks = weeks !== null && weeks >= 1 && weeks <= 260;
  const changed = validWeeks && weeks !== class_.billing_cycle_weeks;

  async function handlePreview() {
    if (!validWeeks || !changed || weeks === null) return;
    setIsPreviewing(true);
    setError(null);
    try {
      setPreview(
        await previewClassBillingCycle(class_.id, {
          billing_cycle_weeks: weeks,
          expected_version: class_.version,
        }),
      );
    } catch (requestError) {
      setPreview(null);
      setError(getApiErrorMessage(requestError, "Không thể xem trước ảnh hưởng học phí."));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleApply() {
    if (!preview || reason.trim().length < 3) return;
    setIsApplying(true);
    setError(null);
    try {
      const result = await updateClassBillingCycle(class_.id, {
        billing_cycle_weeks: preview.next_weeks,
        reason: reason.trim(),
        request_id: crypto.randomUUID(),
        expected_version: preview.version,
        expected_fingerprint: preview.preview_fingerprint,
      });
      onApplied(result.class_);
      notify.success(
        result.pending_review_count > 0
          ? `Đã đổi thời lượng gói. Có ${result.pending_review_count} lịch thu cần kiểm tra.`
          : "Đã đổi thời lượng gói.",
      );
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Không thể đổi thời lượng gói."));
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <FormDialogShell
      title="Điều chỉnh thời lượng gói"
      subtitle={`${class_.primary_label} · Hiện tại ${class_.billing_cycle_weeks} tuần`}
      width="md"
      isBusy={isPreviewing || isApplying}
      dirty={changed || reason.length > 0}
      onClose={onClose}
    >
      <FormDialogBody className="space-y-3">
        <FormField
          controlId="package-duration-weeks"
          label="Thời lượng mới"
          error={
            weeks !== null && !validWeeks ? "Nhập thời lượng từ 1 đến 260 tuần." : undefined
          }
        >
          <div className="relative h-8 overflow-hidden rounded-md border border-gray-200 bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <input
              id="package-duration-weeks"
              type="text"
              inputMode="numeric"
              value={weeks ?? ""}
              autoComplete="off"
              autoFocus
              maxLength={3}
              disabled={isPreviewing || isApplying}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, "").slice(0, 3);
                setWeeks(value ? Number(value) : null);
                setPreview(null);
                setError(null);
              }}
              className="form-input-text h-full w-full bg-transparent px-3 pr-12 outline-none"
            />
            <span className="form-input-text pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">
              tuần
            </span>
          </div>
        </FormField>

        {!preview ? (
          <FormNotice>
            Hệ thống sẽ giữ kỳ đang học và mọi khoản đã báo, đã nộp hoặc đã hoàn.
            Lịch mới chỉ bắt đầu từ ranh giới gói an toàn kế tiếp.
          </FormNotice>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <Metric label="Thời lượng" value={`${preview.previous_weeks} → ${preview.next_weeks} tuần`} />
              <Metric label="Học viên ảnh hưởng" value={`${preview.affected_enrollment_count}`} />
              <Metric label="Kỳ hiện tại được giữ" value={`${preview.retained_current_cycle_count}`} />
              <Metric label="Lịch thu cần kiểm tra" value={`${preview.pending_review_count}`} />
            </div>
            {preview.open_payment_request_count > 0 ? (
              <FormNotice tone="warning">
                {preview.open_payment_request_count} yêu cầu thanh toán cũ sẽ được thu hồi khi áp dụng.
              </FormNotice>
            ) : null}
            {preview.students.length > 0 ? (
              <details className="rounded-lg border border-gray-200 bg-white">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700">
                  Xem {preview.students.length} học viên và ngày áp dụng
                </summary>
                <div className="max-h-48 divide-y divide-gray-100 overflow-y-auto border-t border-gray-200">
                  {preview.students.map((student) => (
                    <div key={student.enrollment_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-gray-700">
                        {student.student_name}
                        {student.student_code ? ` · ${student.student_code}` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-500">
                        Từ {formatDate(student.transition_on)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <FormField
              controlId="package-duration-reason"
              label="Lý do điều chỉnh"
              error={reason.length > 0 && reason.trim().length < 3 ? "Nhập ít nhất 3 ký tự." : undefined}
            >
              <textarea
                id="package-duration-reason"
                rows={3}
                maxLength={500}
                value={reason}
                autoComplete="off"
                disabled={isApplying}
                placeholder="Ví dụ: Điều chỉnh chương trình học theo thỏa thuận mới"
                onChange={(event) => setReason(event.target.value)}
                className="form-input-text min-h-20 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </FormField>
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </FormDialogBody>
      <FormDialogFooter
        right={
          <>
            <Button type="button" variant="outline" disabled={isPreviewing || isApplying} onClick={onClose}>
              Hủy
            </Button>
            {!preview ? (
              <Button type="button" disabled={!changed || isPreviewing} onClick={() => void handlePreview()}>
                {isPreviewing ? <LoadingLabel label="Đang kiểm tra" /> : "Xem ảnh hưởng"}
              </Button>
            ) : (
              <Button type="button" disabled={reason.trim().length < 3 || isApplying} onClick={() => void handleApply()}>
                {isApplying ? <LoadingLabel label="Đang áp dụng" /> : "Xác nhận thay đổi"}
              </Button>
            )}
          </>
        }
      />
    </FormDialogShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-gray-800">{value}</div>
    </div>
  );
}
