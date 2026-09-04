"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FormField } from "@/components/ui/form-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  useSlidePanelDuration,
} from "@/lib/ui/slide-panel-motion";
import type {
  AffectedEnrollmentImpact,
  StudentResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

export type StudentStartDateDialogProps = {
  student: StudentResponse;
  affectedEnrollments: AffectedEnrollmentImpact[];
  isApplying: boolean;
  onConfirm: (decisions: Record<string, string>, reason: string) => void;
  onClose: () => void;
};

// Canonical strategy descriptors
export const DECISION_STRATEGIES = {
  KEEP_CURRENT_THEN_REANCHOR: "Thu nốt kỳ cũ cuối cùng, rồi đổi qua kỳ mới",
  REANCHOR_CURRENT_CYCLE: "Bỏ qua kỳ cũ và qua kỳ mới",
  KEEP_EXISTING_SCHEDULE: "Giữ nguyên toàn bộ lịch thu cũ",
} as const;

function getOldCycleRange(enr: AffectedEnrollmentImpact): { start: string; end: string } {
  const keepOpt = enr.decisions.find((d) => d.decision_code === "KEEP_EXISTING_SCHEDULE");
  if (keepOpt && keepOpt.coverage_start && keepOpt.coverage_end) {
    return { start: keepOpt.coverage_start, end: keepOpt.coverage_end };
  }
  const start = enr.old_enrollment_date || enr.new_enrollment_date;
  const d = new Date(start);
  d.setMonth(d.getMonth() + 1);
  const end = d.toISOString().slice(0, 10);
  return { start, end };
}

export function StudentStartDateDialog({
  student,
  affectedEnrollments,
  isApplying,
  onConfirm,
  onClose,
}: StudentStartDateDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const transitionDuration = useSlidePanelDuration(panelRef);

  const [decisions, setDecisions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const enr of affectedEnrollments) {
      const preferred =
        enr.decisions.find((d) => d.decision_code === "KEEP_CURRENT_THEN_REANCHOR") ||
        enr.decisions.find((d) => d.decision_code === "REANCHOR_CURRENT_CYCLE") ||
        enr.decisions[0];
      initial[enr.enrollment_id] = preferred?.decision_code || "KEEP_CURRENT_THEN_REANCHOR";
    }
    return initial;
  });

  const [reason, setReason] = useState("Điều chỉnh ngày bắt đầu theo hồ sơ học viên");

  useEffect(() => {
    setMounted(true);
    const timer = window.requestAnimationFrame(() => setIsOpen(true));
    return () => window.cancelAnimationFrame(timer);
  }, []);

  useEffect(() => {
    setDecisions((current) => {
      const next = { ...current };
      for (const enr of affectedEnrollments) {
        if (!next[enr.enrollment_id]) {
          const preferred =
            enr.decisions.find((d) => d.decision_code === "KEEP_CURRENT_THEN_REANCHOR") ||
            enr.decisions.find((d) => d.decision_code === "REANCHOR_CURRENT_CYCLE") ||
            enr.decisions[0];
          next[enr.enrollment_id] = preferred?.decision_code || "KEEP_CURRENT_THEN_REANCHOR";
        }
      }
      return next;
    });
  }, [affectedEnrollments]);

  function handleClose() {
    if (isApplying) return;
    setIsOpen(false);
    window.setTimeout(onClose, transitionDuration);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 2 || isApplying) return;
    onConfirm(decisions, reason.trim());
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-start-date-slide-title"
      className="fixed inset-0 z-[70] flex justify-end"
    >
      {/* Backdrop */}
      <div
        style={getSlideBackdropStyle(transitionDuration)}
        className={cn(
          "absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={handleClose}
      />

      {/* Slide Panel from Right */}
      <div
        ref={panelRef}
        style={getSlidePanelStyle(transitionDuration)}
        className={cn(
          "relative z-10 flex h-full w-full max-w-[500px] flex-col bg-white shadow-2xl transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header - Synchronized typography, zero redundant close button */}
        <header className="border-b border-primary/15 bg-primary-soft/60 px-5 py-3.5">
          <h2
            id="student-start-date-slide-title"
            className="section-title-text text-primary"
          >
            Kỳ thu học phí
          </h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">
            Học viên: <span className="font-semibold text-gray-900">{student.full_name}</span>
          </p>
        </header>

        {/* Form Body */}
        <form
          onSubmit={handleFormSubmit}
          className="flex min-h-0 flex-1 flex-col justify-between"
        >
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {affectedEnrollments.map((enr) => {
              const chosenCode = decisions[enr.enrollment_id];
              const oldCycle = getOldCycleRange(enr);

              // Only show the 2 meaningful actionable choices
              const displayOptions = enr.decisions.filter(
                (opt) =>
                  opt.decision_code === "KEEP_CURRENT_THEN_REANCHOR" ||
                  opt.decision_code === "REANCHOR_CURRENT_CYCLE",
              );

              const optionsToRender =
                displayOptions.length > 0
                  ? displayOptions
                  : enr.decisions.filter((opt) => opt.allowed !== false);

              return (
                <div key={enr.enrollment_id} className="space-y-3.5">
                  {/* Transition Date Summary - Synchronized tokens */}
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-2.5 text-sm">
                    <span className="font-semibold text-gray-900">
                      Lớp {enr.class_name}
                    </span>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="text-gray-500 line-through tabular-nums">
                        {enr.old_enrollment_date
                          ? formatDate(enr.old_enrollment_date)
                          : "Chưa đặt"}
                      </span>
                      <span className="text-gray-400 font-normal">→</span>
                      <span className="font-semibold text-primary tabular-nums">
                        {formatDate(enr.new_enrollment_date)}
                      </span>
                    </div>
                  </div>

                  {/* Decision Option Cards */}
                  <div className="space-y-2">
                    <div className="form-label-text select-none text-gray-800">
                      Chọn cách xử lý kỳ thu học phí:
                    </div>

                    <div className="space-y-2.5">
                      {optionsToRender.map((opt) => {
                        const isSelected = opt.decision_code === chosenCode;

                        if (opt.decision_code === "KEEP_CURRENT_THEN_REANCHOR") {
                          return (
                            <div
                              key={opt.decision_code}
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [enr.enrollment_id]: opt.decision_code,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setDecisions((prev) => ({
                                    ...prev,
                                    [enr.enrollment_id]: opt.decision_code,
                                  }));
                                }
                              }}
                              className={cn(
                                "w-full rounded-lg border p-3.5 text-left transition cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/25",
                                isSelected
                                  ? "border-primary ring-1 ring-primary/30 bg-white"
                                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50",
                              )}
                            >
                              <span className="text-sm font-medium text-gray-900 leading-normal block">
                                {DECISION_STRATEGIES.KEEP_CURRENT_THEN_REANCHOR}
                              </span>

                              <div className="mt-2.5 grid grid-cols-2 gap-3 rounded-md border border-gray-100 bg-gray-50/70 p-2.5 text-sm">
                                <div>
                                  <span className="text-xs text-gray-500 font-normal block">
                                    Kỳ cũ (thu nốt):
                                  </span>
                                  <span className="font-medium text-gray-900 mt-0.5 block tabular-nums">
                                    {formatDate(oldCycle.start)} → {formatDate(oldCycle.end)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-gray-500 font-normal block">
                                    Kỳ mới (bắt đầu):
                                  </span>
                                  <span className="font-medium text-gray-900 mt-0.5 block tabular-nums">
                                    {formatDate(opt.coverage_start)} → {formatDate(opt.coverage_end)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (opt.decision_code === "REANCHOR_CURRENT_CYCLE") {
                          return (
                            <div
                              key={opt.decision_code}
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [enr.enrollment_id]: opt.decision_code,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setDecisions((prev) => ({
                                    ...prev,
                                    [enr.enrollment_id]: opt.decision_code,
                                  }));
                                }
                              }}
                              className={cn(
                                "w-full rounded-lg border p-3.5 text-left transition cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/25",
                                isSelected
                                  ? "border-primary ring-1 ring-primary/30 bg-white"
                                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50",
                              )}
                            >
                              <span className="text-sm font-medium text-gray-900 leading-normal block">
                                {DECISION_STRATEGIES.REANCHOR_CURRENT_CYCLE}
                              </span>

                              <div className="mt-2.5 grid grid-cols-2 gap-3 rounded-md border border-gray-100 bg-gray-50/70 p-2.5 text-sm">
                                <div>
                                  <span className="text-xs text-gray-500 font-normal block">
                                    Kỳ cũ (bỏ qua):
                                  </span>
                                  <span className="font-medium text-gray-900 mt-0.5 block tabular-nums">
                                    {formatDate(oldCycle.start)} → {formatDate(oldCycle.end)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-gray-500 font-normal block">
                                    Kỳ mới (thu ngay):
                                  </span>
                                  <span className="font-medium text-gray-900 mt-0.5 block tabular-nums">
                                    {formatDate(opt.coverage_start)} → {formatDate(opt.coverage_end)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // KEEP_EXISTING_SCHEDULE fallback
                        return (
                          <div
                            key={opt.decision_code}
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setDecisions((prev) => ({
                                ...prev,
                                [enr.enrollment_id]: opt.decision_code,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setDecisions((prev) => ({
                                  ...prev,
                                  [enr.enrollment_id]: opt.decision_code,
                                }));
                              }
                            }}
                            className={cn(
                              "w-full rounded-lg border p-3.5 text-left transition cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/25",
                              isSelected
                                ? "border-primary ring-1 ring-primary/30 bg-white"
                                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50",
                            )}
                          >
                            <span className="text-sm font-medium text-gray-900 leading-normal block">
                              {DECISION_STRATEGIES.KEEP_EXISTING_SCHEDULE}
                            </span>

                            <div className="mt-2.5 rounded-md border border-gray-100 bg-gray-50/70 p-2.5 text-sm">
                              <span className="text-xs text-gray-500 font-normal block">
                                Lịch thu học phí:
                              </span>
                              <span className="font-medium text-gray-800 mt-0.5 block tabular-nums">
                                Giữ nguyên toàn bộ các kỳ thu đã xếp ({formatDate(opt.coverage_start)} → {formatDate(opt.coverage_end)})
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Reason Textarea - standard browser thin caret via font-normal */}
            <FormField label="Ghi chú lý do" controlId="student-billing-change-reason">
              <textarea
                id="student-billing-change-reason"
                autoComplete="off"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Điều chỉnh ngày bắt đầu theo hồ sơ học viên"
                className="min-h-24 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-[15px] leading-5 font-normal text-gray-900 outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-primary/60 focus:ring-1 focus:ring-primary/15 caret-gray-900"
              />
            </FormField>
          </div>

          {/* Sticky Footer with Standard h-8 Buttons - No icons */}
          <footer className="border-t border-gray-200 bg-white px-5 py-3">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleClose}
                disabled={isApplying}
              >
                Hủy bỏ
              </button>

              <button
                type="submit"
                className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isApplying || reason.trim().length < 2}
              >
                {isApplying ? (
                  <LoadingLabel label="Đang cập nhật..." />
                ) : (
                  "Xác nhận & Cập nhật học phí"
                )}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
