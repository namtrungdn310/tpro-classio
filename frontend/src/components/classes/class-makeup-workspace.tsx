"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { RiErrorWarningLine as ErrorWarning } from "react-icons/ri";
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
import type { ClassResponse, MakeupReasonCode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

const DatePickerSlide = dynamic(
  () => import("@/components/layout/date-picker-slide").then((module) => module.DatePickerSlide),
  { ssr: false },
);

type MakeupWorkspaceProps = {
  class_: ClassResponse;
  isSaving: boolean;
  onClose: () => void;
  onPostponed?: () => void;
  onNestedOverlayChange?: (open: boolean) => void;
};

const REASON_OPTIONS: Array<{ value: MakeupReasonCode; label: string }> = [
  { value: "TEACHER_UNAVAILABLE", label: "Giáo viên bận" },
  { value: "CENTER_OPERATION", label: "Trung tâm điều hành" },
  { value: "OTHER", label: "Lý do khác" },
];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addIsoDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function maxIsoDate(left: string, right: string) {
  return left >= right ? left : right;
}

function differenceInIsoDays(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86_400_000);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function ClassMakeupWorkspace({ class_, isSaving, onClose, onPostponed, onNestedOverlayChange }: MakeupWorkspaceProps) {
  const queryClient = useQueryClient();
  const classDateMin = maxIsoDate(todayIso(), isValidIsoDate(class_.start_date ?? "") ? class_.start_date! : todayIso());
  const classDateMax = isValidIsoDate(class_.end_date ?? "") ? class_.end_date! : addIsoDays(classDateMin, 120);
  const classDateRangeAvailable = classDateMin <= classDateMax;
  const [rangeFrom, setRangeFrom] = useState(classDateMin);
  const [rangeTo, setRangeTo] = useState("");
  const [reasonCode, setReasonCode] = useState<MakeupReasonCode>("TEACHER_UNAVAILABLE");
  const [reasonNote, setReasonNote] = useState("");
  const [datePickerTarget, setDatePickerTarget] = useState<"from" | "to" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const datesAreValid = isValidIsoDate(rangeFrom) && isValidIsoDate(rangeTo);
  const rangeSpanDays = datesAreValid ? differenceInIsoDays(rangeFrom, rangeTo) : null;
  const rangeIsValid = datesAreValid && classDateRangeAvailable && rangeFrom >= classDateMin && rangeTo <= classDateMax && rangeFrom <= rangeTo && rangeSpanDays !== null && rangeSpanDays <= 120;
  const rangeError = !rangeTo
    ? null
    : !datesAreValid
      ? "Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc."
      : !classDateRangeAvailable
        ? "Lớp không còn trong thời gian có thể hoãn."
        : rangeFrom > rangeTo
          ? "Ngày kết thúc phải từ ngày bắt đầu trở đi."
          : rangeFrom < classDateMin || rangeTo > classDateMax
            ? "Ngày hoãn phải nằm trong thời gian hoạt động của lớp."
            : rangeSpanDays !== null && rangeSpanDays > 120
              ? "Khoảng hoãn tối đa 120 ngày. Hãy chọn mốc bắt đầu gần hơn."
              : null;

  useEffect(() => {
    setRangeFrom(classDateMin);
    setRangeTo("");
    setFormError(null);
    setDatePickerTarget(null);
  }, [class_.id, classDateMin]);

  useEffect(() => {
    onNestedOverlayChange?.(datePickerTarget !== null);
    return () => onNestedOverlayChange?.(false);
  }, [datePickerTarget, onNestedOverlayChange]);

  const occurrencesQuery = useQuery({
    queryKey: classQueryKeys.occurrences(class_.id, { from: rangeFrom, to: rangeTo }),
    queryFn: () => getClassOccurrences(class_.id, rangeFrom, rangeTo),
    enabled: rangeIsValid,
    staleTime: 30_000,
    retry: false,
  });
  const suspensionPreviewQuery = useQuery({
    queryKey: classQueryKeys.suspensionPreview(class_.id, rangeFrom, rangeTo),
    queryFn: () => previewClassSuspension(class_.id, { suspended_from: rangeFrom, resume_on: rangeTo }),
    enabled: rangeIsValid,
    staleTime: 15_000,
    retry: false,
  });
  const postponeMutation = useMutation({
    mutationFn: (payload: { suspended_from: string; resume_on: string; reason_code: MakeupReasonCode; reason_note: string | null; request_id: string }) => createClassSuspension(class_.id, payload),
    onSuccess: () => {
      setReasonNote("");
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: classQueryKeys.occurrences(class_.id, { from: rangeFrom, to: rangeTo }) });
      void invalidateDomainQueries(queryClient, { classes: true, fees: true, dashboard: true });
      onPostponed?.();
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "Không thể hoãn lớp.")),
  });

  const previewOptions = (occurrencesQuery.data?.occurrences ?? []).filter((item) => item.kind === "REGULAR");
  const postponableOccurrences = previewOptions.filter((item) => item.adjustable && !item.already_adjusted && !item.passed);
  const affectedMembers = suspensionPreviewQuery.data?.member_summary.filter((item) => item.overlap_days > 0) ?? [];

  function submitPostpone() {
    if (!rangeIsValid || postponableOccurrences.length === 0) {
      setFormError("Không có buổi học hợp lệ trong khoảng ngày đã chọn.");
      return;
    }
    if (reasonCode === "OTHER" && !reasonNote.trim()) {
      setFormError("Vui lòng nhập ghi chú lý do khi chọn 'Lý do khác'.");
      return;
    }
    postponeMutation.mutate({ suspended_from: rangeFrom, resume_on: rangeTo, reason_code: reasonCode, reason_note: reasonNote.trim() || null, request_id: crypto.randomUUID() });
  }

  const datePickerToMin = isValidIsoDate(rangeFrom) ? rangeFrom : classDateMin;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h2 data-workspace-heading tabIndex={-1} className="sr-only">Hoãn buổi học — {class_.primary_label}</h2>
        <section aria-label="Hoãn buổi học" className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[13px] leading-[18px] text-gray-500">Chọn khoảng ngày để xem các buổi học trong phạm vi thời gian lớp có thể hoãn (tối đa chỉ được hoãn 120 ngày).</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label id="makeup-range-from-label" htmlFor="makeup-range-from" className="form-label-text inline-block select-none text-gray-800">Từ ngày</label>
              <button id="makeup-range-from" type="button" aria-haspopup="dialog" aria-labelledby="makeup-range-from-label makeup-range-from-value" aria-describedby={rangeError ? "makeup-range-error" : undefined} onClick={() => setDatePickerTarget("from")} className={cn(formTextControlClassName, "mt-1 select-none text-left tabular-nums")}><span id="makeup-range-from-value">{formatDate(rangeFrom, "Chọn ngày")}</span></button>
            </div>
            <div className="min-w-0">
              <label id="makeup-range-to-label" htmlFor="makeup-range-to" className="form-label-text inline-block select-none text-gray-800">Đến ngày</label>
              <button id="makeup-range-to" type="button" aria-haspopup="dialog" aria-labelledby="makeup-range-to-label makeup-range-to-value" aria-describedby={rangeError ? "makeup-range-error" : undefined} onClick={() => setDatePickerTarget("to")} className={cn(formTextControlClassName, "mt-1 select-none text-left tabular-nums")}><span id="makeup-range-to-value">{formatDate(rangeTo, "Chọn ngày")}</span></button>
            </div>
          </div>
          {rangeError ? <p id="makeup-range-error" role="alert" aria-live="polite" className="mt-2 text-[13px] leading-[18px] text-red-700">{rangeError}</p> : null}
          {typeof document !== "undefined" ? createPortal(
            <DatePickerSlide
              isOpen={datePickerTarget !== null}
              title={datePickerTarget === "to" ? "Chọn ngày kết thúc hoãn" : "Chọn ngày bắt đầu hoãn"}
              description="Chọn ngày trong phạm vi cần rà soát. Bạn có thể đổi lại ngày trước khi lưu hoãn lớp."
              currentValue={datePickerTarget === "to" ? rangeTo || undefined : rangeFrom}
              initialViewDate={datePickerTarget === "to" && !rangeTo ? rangeFrom : undefined}
              minDate={datePickerTarget === "to" ? datePickerToMin : classDateMin}
              maxDate={classDateMax}
              onClose={() => setDatePickerTarget(null)}
              onSelectDate={(value) => { if (datePickerTarget === "to") setRangeTo(value); else setRangeFrom(value); setFormError(null); }}
            />,
            document.body,
          ) : null}
          {occurrencesQuery.isFetching || suspensionPreviewQuery.isFetching ? <div aria-busy="true" className="mt-3 rounded-lg border border-primary/20 bg-primary-soft/30 px-3 py-2 text-[13px] leading-[18px] text-gray-700"><LoadingLabel label="Đang rà soát các buổi học và ngày thu" /></div> : occurrencesQuery.isError ? <div className="mt-3"><DataSectionError title="Không tải được các buổi học" description={getApiErrorMessage(occurrencesQuery.error, "Vui lòng thử lại.")} onRetry={() => void occurrencesQuery.refetch()} /></div> : suspensionPreviewQuery.isError ? <div className="mt-3"><DataSectionError title="Không thể tính ngày thu sau hoãn" description={getApiErrorMessage(suspensionPreviewQuery.error, "Vui lòng thử lại.")} onRetry={() => void suspensionPreviewQuery.refetch()} /></div> : occurrencesQuery.isSuccess && suspensionPreviewQuery.isSuccess ? <div className="mt-3 rounded-lg border border-primary/20 bg-primary-soft/30 px-3 py-2 text-[13px] leading-[18px] text-gray-700">{postponableOccurrences.length > 0 ? <>Hệ thống sẽ tự động hoãn <strong className="tabular-nums">{postponableOccurrences.length}</strong> buổi hợp lệ.{affectedMembers.length > 0 ? <> Ngày thu sẽ dời theo số ngày hoãn thực tế của <strong className="tabular-nums">{affectedMembers.length}</strong> học viên bị ảnh hưởng.</> : null}</> : "Không có buổi học hợp lệ để hoãn trong khoảng ngày đã chọn."}</div> : null}
          <div className="mt-3 grid gap-3">
            <label className="form-label-text block w-full select-none text-gray-800">
              <span className="block">Lý do hoãn</span>
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value as MakeupReasonCode)}
                className={cn(formTextControlClassName, "mt-1 w-full")}
              >
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="form-label-text block w-full select-none text-gray-800">
              <span className="block">Ghi chú</span>
              <textarea
                value={reasonNote}
                maxLength={500}
                autoComplete="off"
                rows={2}
                onChange={(event) => setReasonNote(event.target.value)}
                placeholder="Thông tin cần lưu ý về lần hoãn lớp (nếu có)"
                className={cn(formTextControlClassName, "mt-1 block h-16 min-h-16 w-full resize-none py-2 leading-5")}
              />
            </label>
          </div>
          {formError ? <p role="alert" aria-live="polite" className="mt-2 flex items-start gap-1.5 text-[13px] leading-[18px] text-red-700"><ErrorWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{formError}</p> : null}
        </section>
      </div>
      <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3"><div className="flex items-center justify-end gap-2"><Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" onClick={onClose}>Đóng</Button><PendingActionButton type="button" isPending={postponeMutation.isPending} pendingLabel="Đang hoãn" disabled={isSaving || occurrencesQuery.isFetching || suspensionPreviewQuery.isFetching || suspensionPreviewQuery.isError || postponableOccurrences.length === 0} onClick={submitPostpone} className="h-8 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Hoãn {postponableOccurrences.length > 0 ? `(${postponableOccurrences.length})` : ""}</PendingActionButton></div></div>
    </div>
  );
}
