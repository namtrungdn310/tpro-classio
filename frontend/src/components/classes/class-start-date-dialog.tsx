"use client";

import { useEffect, useState } from "react";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowRightSLine as ChevronRight,
  RiCalendarLine as Calendar,
  RiGroupLine as Users,
  RiErrorWarningLine as ShieldAlert,
  RiSparklingLine as Sparkles,
} from "react-icons/ri";

import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormField } from "@/components/ui/form-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import { previewClassStartDate, updateClassStartDate } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import type {
  ClassResponse,
  ClassStartDatePreview,
  ClassUpdate,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

type Props = {
  class_: ClassResponse;
  newStartDate: string;
  classPatch?: ClassUpdate;
  onApplied: (updated: ClassResponse) => void;
  onClose: () => void;
};

export function ClassStartDateDialog({
  class_,
  newStartDate,
  classPatch,
  onApplied,
  onClose,
}: Props) {
  const notify = useToast();
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ClassStartDatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(true);
  const [isApplying, setIsApplying] = useState(false);

  const [defaultDecision, setDefaultDecision] = useState<string>("REANCHOR_NEXT_BOUNDARY");
  const [enrollmentDecisions, setEnrollmentDecisions] = useState<Record<string, string>>({});
  const [expandedEnrollments, setExpandedEnrollments] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    async function fetchPreview() {
      setIsPreviewing(true);
      setError(null);
      try {
        const res = await previewClassStartDate(class_.id, {
          start_date: newStartDate,
          expected_version: class_.version,
          class_patch: classPatch,
        });
        if (active) {
          setPreview(res);
          if (res.affected_enrollments.length > 0) {
            const firstRec = res.affected_enrollments[0]?.recommended_decision || "REANCHOR_NEXT_BOUNDARY";
            setDefaultDecision(firstRec);
            const initialDecisions: Record<string, string> = {};
            for (const enr of res.affected_enrollments) {
              initialDecisions[enr.enrollment_id] = enr.recommended_decision || firstRec;
            }
            setEnrollmentDecisions(initialDecisions);
          }
        }
      } catch (err) {
        if (active) {
          setError(getApiErrorMessage(err, "Không thể xem trước tác động dời ngày bắt đầu."));
          setPreview(null);
        }
      } finally {
        if (active) {
          setIsPreviewing(false);
        }
      }
    }
    void fetchPreview();
    return () => {
      active = false;
    };
  }, [class_.id, class_.version, newStartDate, classPatch]);

  async function handleApply() {
    if (!preview || !preview.can_apply || reason.trim().length < 3) return;
    setIsApplying(true);
    setError(null);
    try {
      const overrides = (preview.affected_enrollments || []).map((enr) => ({
        enrollment_id: enr.enrollment_id,
        decision_code: enrollmentDecisions[enr.enrollment_id] || defaultDecision,
      }));

      const updated = await updateClassStartDate(class_.id, {
        start_date: newStartDate,
        reason: reason.trim(),
        expected_version: preview.version,
        expected_fingerprint: preview.preview_fingerprint,
        default_decision: defaultDecision,
        enrollment_overrides: overrides,
        class_patch: classPatch,
      });

      notify.success("Đã cập nhật ngày bắt đầu và thông tin lớp học thành công.");
      onApplied(updated);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Không thể dời ngày bắt đầu lớp học."));
    } finally {
      setIsApplying(false);
    }
  }

  const affectedCount = preview?.affected_enrollment_count ?? 0;
  const cannotApply = !preview || !preview.can_apply;
  const isBlockedByHistory = Boolean(preview && !preview.can_apply && preview.blocking_reason);

  return (
    <FormDialogShell
      title="Xem trước dời ngày bắt đầu lớp học"
      subtitle={`${class_.name} · Mốc mới: ${formatDate(newStartDate)}`}
      width="lg"
      isBusy={isPreviewing || isApplying}
      dirty={reason.trim().length > 0}
      onClose={onClose}
    >
      <FormDialogBody className="space-y-4">
        {/* Date Transition Card */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Ngày bắt đầu hiện tại
              </div>
              <div className="font-semibold text-slate-800">
                {class_.start_date ? formatDate(class_.start_date) : "Chưa đặt"}
              </div>
            </div>
          </div>

          <div className="hidden text-slate-400 sm:block">
            <ChevronRight className="h-5 w-5" />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Ngày bắt đầu mới
              </div>
              <div className="font-bold text-emerald-900">
                {formatDate(newStartDate)}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {/* Blocking History Alert */}
        {isBlockedByHistory ? (
          <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <div className="font-semibold text-rose-900">Không thể dời ngày bắt đầu</div>
              <div className="mt-1 leading-relaxed">{preview?.blocking_reason}</div>
            </div>
          </div>
        ) : null}

        {/* Loading Preview */}
        {isPreviewing ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <LoadingLabel label="Đang kiểm tra tác động học phí và lịch học..." />
          </div>
        ) : null}

        {/* Affected Students Review */}
        {!isPreviewing && preview && preview.can_apply && affectedCount > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Users className="h-4 w-4 text-blue-600" />
                <span>Học viên bị ảnh hưởng ({affectedCount})</span>
              </div>
              <div className="text-xs text-slate-500">
                Cần chọn phương án xử lý chu kỳ thu học phí
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {preview.affected_enrollments.map((enr) => {
                const isExpanded = Boolean(expandedEnrollments[enr.enrollment_id]);
                const chosenCode = enrollmentDecisions[enr.enrollment_id] || defaultDecision;
                const chosenDecision = enr.decisions.find((d) => d.decision_code === chosenCode);

                return (
                  <div
                    key={enr.enrollment_id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition hover:border-slate-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                          {enr.student_name ? enr.student_name.charAt(0).toUpperCase() : "H"}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-900">{enr.student_name}</div>
                          <div className="text-xs text-slate-500">
                            Ngày vào lớp: {enr.old_enrollment_date ? formatDate(enr.old_enrollment_date) : "—"} →{" "}
                            <span className="font-semibold text-emerald-700">{formatDate(enr.new_enrollment_date)}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEnrollments((prev) => ({
                            ...prev,
                            [enr.enrollment_id]: !prev[enr.enrollment_id],
                          }))
                        }
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <span>{chosenDecision?.label || "Chọn cách tính"}</span>
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
                        />
                      </button>
                    </div>

                    {/* Decision Selector */}
                    {isExpanded ? (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <div className="text-xs font-semibold text-slate-600">
                          Chọn cách xử lý kỳ thu cho học viên này:
                        </div>
                        <div className="grid gap-1.5">
                          {enr.decisions.map((opt) => {
                            const isSelected = opt.decision_code === chosenCode;
                            return (
                              <label
                                key={opt.decision_code}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 text-xs transition",
                                  isSelected
                                    ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                                    : "border-slate-200 bg-white hover:bg-slate-50",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`decision-${enr.enrollment_id}`}
                                  checked={isSelected}
                                  onChange={() =>
                                    setEnrollmentDecisions((prev) => ({
                                      ...prev,
                                      [enr.enrollment_id]: opt.decision_code,
                                    }))
                                  }
                                  className="mt-0.5 text-blue-600"
                                />
                                <div className="flex-1 space-y-0.5">
                                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                                    <span>{opt.label}</span>
                                    {opt.recommended ? (
                                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-800">
                                        Khuyến nghị
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="text-slate-500">{opt.description}</div>
                                  <div className="text-[11px] text-slate-400">
                                    Chu kỳ: {formatDate(opt.coverage_start)} – {formatDate(opt.coverage_end)} · Hạn đóng:{" "}
                                    {formatDate(opt.due_date)}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Reason Input */}
        {!cannotApply ? (
          <FormField
            controlId="start-date-change-reason"
            label="Lý do thay đổi ngày bắt đầu *"
            hint="Ghi chú rõ nguyên nhân để lưu nhật ký điều chỉnh của lớp."
          >
            <input
              id="start-date-change-reason"
              type="text"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: Dời ngày khai giảng theo lịch nghỉ của trung tâm"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
          </FormField>
        ) : null}
      </FormDialogBody>

      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isApplying}>
          Hủy bỏ
        </Button>
        <Button
          type="button"
          onClick={() => void handleApply()}
          disabled={cannotApply || isPreviewing || isApplying || reason.trim().length < 3}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isApplying ? <LoadingLabel label="Đang cập nhật..." /> : "Xác nhận & Cập nhật"}
        </Button>
      </FormDialogFooter>
    </FormDialogShell>
  );
}
