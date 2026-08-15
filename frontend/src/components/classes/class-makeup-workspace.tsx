"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiCalendarCheckLine as CalendarCheck,
  RiCalendarTodoLine as CalendarTodo,
  RiCheckboxCircleLine as CheckCircle,
  RiCloseCircleLine as CloseCircle,
  RiErrorWarningLine as ErrorWarning,
  RiTimeLine as TimeLine,
} from "react-icons/ri";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  createPostponement,
  getClassAdjustments,
  getClassOccurrences,
  previewMakeupSchedule,
} from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { DataSectionError } from "@/components/ui/data-section-state";
import type {
  ClassResponse,
  ClassSessionExceptionResponse,
  ExceptionDisplayStatus,
  MakeupReasonCode,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";

export type MakeupAction =
  | "postpone"
  | "schedule"
  | "unschedule"
  | "complete"
  | "restore";

type MakeupWorkspaceProps = {
  class_: ClassResponse;
  isSaving: boolean;
  onClose: () => void;
  onAction: (action: MakeupAction, exceptionId: string, payload: object) => void;
  onPostponed?: () => void;
};

const REASON_OPTIONS: Array<{ value: MakeupReasonCode; label: string }> = [
  { value: "TEACHER_UNAVAILABLE", label: "Giáo viên bận" },
  { value: "CENTER_OPERATION", label: "Trung tâm điều hành" },
  { value: "OTHER", label: "Lý do khác" },
];

const STATUS_LABELS: Record<ExceptionDisplayStatus, string> = {
  MAKEUP_PENDING: "Chờ xếp lịch bù",
  MAKEUP_SCHEDULED: "Đã xếp lịch bù",
  AWAITING_CONFIRMATION: "Chờ xác nhận",
  MAKEUP_COMPLETED: "Đã học bù",
  RESTORED: "Đã khôi phục buổi gốc",
  CANCELLED: "Đã hủy",
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function isValidIsoDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function parseScheduleTime(value: string): string | null {
  if (!SCHEDULE_TIME_PATTERN.test(value)) {
    return null;
  }
  const [datePart, timePart] = value.split(" ");
  if (!isValidIsoDate(datePart)) {
    return null;
  }
  const [hours, minutes] = timePart.split(":").map(Number);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  const local = new Date(
    Number(datePart.slice(0, 4)),
    Number(datePart.slice(5, 7)) - 1,
    Number(datePart.slice(8, 10)),
    hours,
    minutes,
  );
  return local.toISOString();
}

export function ClassMakeupWorkspace({
  class_,
  isSaving,
  onClose,
  onAction,
  onPostponed,
}: MakeupWorkspaceProps) {
  const queryClient = useQueryClient();
  const [rangeFrom, setRangeFrom] = useState(todayIso());
  const [rangeTo, setRangeTo] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 14);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
      end.getDate(),
    ).padStart(2, "0")}`;
  });
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reasonCode, setReasonCode] = useState<MakeupReasonCode>("TEACHER_UNAVAILABLE");
  const [reasonNote, setReasonNote] = useState("");
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduleTarget, setScheduleTarget] = useState<ClassSessionExceptionResponse | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [conflicts, setConflicts] = useState<{ code: string; message: string }[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const scheduleInputRef = useRef<HTMLInputElement>(null);

  const occurrencesQuery = useQuery({
    queryKey: classQueryKeys.occurrences(class_.id, { from: rangeFrom, to: rangeTo }),
    queryFn: () => getClassOccurrences(class_.id, rangeFrom, rangeTo),
    enabled: isValidIsoDate(rangeFrom) && isValidIsoDate(rangeTo),
    staleTime: 30_000,
    retry: false,
  });
  const adjustmentsQuery = useQuery({
    queryKey: classQueryKeys.adjustments(class_.id, {}),
    queryFn: () => getClassAdjustments(class_.id),
    staleTime: 30_000,
    retry: false,
  });

  const postponeMutation = useMutation({
    mutationFn: (payload: {
      original_start_at: string[];
      reason_code: MakeupReasonCode;
      reason_note: string | null;
      schedule_now: boolean;
      request_id: string;
    }) => createPostponement(class_.id, payload),
    onSuccess: () => {
      setSelectedKeys(new Set());
      setReasonNote("");
      setFormError(null);
      void queryClient.invalidateQueries({
        queryKey: classQueryKeys.occurrences(class_.id, { from: rangeFrom, to: rangeTo }),
      });
      void queryClient.invalidateQueries({
        queryKey: classQueryKeys.adjustments(class_.id, {}),
      });
      onPostponed?.();
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "Không thể hoãn buổi học.")),
  });

  const schedulePreviewQuery = useQuery({
    queryKey: classQueryKeys.makeupSchedulePreview(
      scheduleTarget?.id ?? "",
      scheduleTime,
    ),
    queryFn: () => previewMakeupSchedule(scheduleTarget!.id, parseScheduleTime(scheduleTime)!),
    enabled: Boolean(scheduleTarget && parseScheduleTime(scheduleTime) !== null),
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!schedulePreviewQuery.data) {
      return;
    }
    const preview = schedulePreviewQuery.data;
    const items = [
      ...preview.conflicts.map((item) => ({ code: item.code, message: item.message })),
      ...preview.staff_inactive.map((item) => ({
        code: "STAFF_INACTIVE",
        message: `${item.display_name} đã ngừng hoạt động — không thể xếp buổi bù.`,
      })),
    ];
    setConflicts(items);
    setFormError(items[0]?.message ?? null);
  }, [schedulePreviewQuery.data]);

  const groupedExceptions = useMemo(() => {
    const groups: Record<ExceptionDisplayStatus, ClassSessionExceptionResponse[]> = {
      MAKEUP_PENDING: [],
      MAKEUP_SCHEDULED: [],
      AWAITING_CONFIRMATION: [],
      MAKEUP_COMPLETED: [],
      RESTORED: [],
      CANCELLED: [],
    };
    for (const item of adjustmentsQuery.data?.exceptions ?? []) {
      groups[item.display_status]?.push(item);
    }
    return groups;
  }, [adjustmentsQuery.data]);

  const unresolvedCount = groupedExceptions.MAKEUP_PENDING.length + groupedExceptions.MAKEUP_SCHEDULED.length + groupedExceptions.AWAITING_CONFIRMATION.length;

  function toggleOccurrence(key: string) {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function submitPostpone() {
    const selected = (occurrencesQuery.data?.occurrences ?? []).filter((item) =>
      selectedKeys.has(item.key),
    );
    if (selected.length === 0) {
      setFormError("Vui lòng chọn ít nhất một buổi học để hoãn.");
      return;
    }
    if (reasonCode === "OTHER" && !reasonNote.trim()) {
      setFormError("Vui lòng nhập ghi chú lý do khi chọn 'Lý do khác'.");
      return;
    }
    postponeMutation.mutate({
      original_start_at: selected.map((item) => item.original_start_at),
      reason_code: reasonCode,
      reason_note: reasonNote.trim() || null,
      schedule_now: scheduleNow,
      request_id: crypto.randomUUID(),
    });
  }

  function openSchedule(exception: ClassSessionExceptionResponse) {
    setScheduleTarget(exception);
    setScheduleTime("");
    setConflicts([]);
    setFormError(null);
    window.setTimeout(() => scheduleInputRef.current?.focus(), 50);
  }

  function submitSchedule() {
    if (!scheduleTarget) {
      setFormError("Vui lòng chọn buổi học cần xếp lịch bù.");
      return;
    }
    const parsed = parseScheduleTime(scheduleTime);
    if (!parsed) {
      setFormError("Vui lòng nhập ngày giờ dạng YYYY-MM-DD HH:MM.");
      return;
    }
    if (conflicts.length > 0) {
      setFormError("Buổi bù đang có xung đột. Vui lòng chọn khung giờ khác.");
      return;
    }
    onAction(
      "schedule",
      scheduleTarget.id,
      {
        replacement_start_at: parsed,
        request_id: crypto.randomUUID(),
        expected_version: scheduleTarget.version,
      },
    );
    setScheduleTarget(null);
  }

  const previewOptions = (occurrencesQuery.data?.occurrences ?? []).filter(
    (item) => item.kind === "REGULAR",
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h2 data-workspace-heading tabIndex={-1} className="sr-only">
          Hoãn và học bù — {class_.primary_label}
        </h2>

        <section aria-label="Tóm tắt nghĩa vụ học bù" className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-gray-700">
            <span className="inline-flex items-center gap-1.5">
              <CalendarTodo className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Chờ xếp: <strong className="tabular-nums">{groupedExceptions.MAKEUP_PENDING.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              Đã xếp: <strong className="tabular-nums">{groupedExceptions.MAKEUP_SCHEDULED.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TimeLine className="h-4 w-4 text-orange-600" aria-hidden="true" />
              Chờ xác nhận: <strong className="tabular-nums">{groupedExceptions.AWAITING_CONFIRMATION.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Đã học bù: <strong className="tabular-nums">{groupedExceptions.MAKEUP_COMPLETED.length}</strong>
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-[18px] text-gray-500">
            Tổng <strong className="tabular-nums">{unresolvedCount}</strong> buổi chưa hoàn tất. Việc
            hoãn/xếp bù <strong>không thay đổi học phí, kỳ thu hay lịch tuần</strong> của lớp.
          </p>
        </section>

        {adjustmentsQuery.isError ? (
          <div className="mt-3">
            <DataSectionError
              title="Không tải được danh sách buổi bù"
              description={getApiErrorMessage(adjustmentsQuery.error, "Vui lòng thử lại.")}
              onRetry={() => void adjustmentsQuery.refetch()}
            />
          </div>
        ) : null}

        {/* Nhóm exception */}
        {(["MAKEUP_PENDING", "MAKEUP_SCHEDULED", "AWAITING_CONFIRMATION"] as const).map(
          (status) =>
            groupedExceptions[status].length > 0 ? (
              <section key={status} aria-label={STATUS_LABELS[status]} className="mt-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  {STATUS_LABELS[status]} ({groupedExceptions[status].length})
                </h3>
                <ul className="mt-1.5 space-y-2">
                  {groupedExceptions[status].map((exception) => (
                    <ExceptionCard
                      key={exception.id}
                      exception={exception}
                      isSaving={isSaving}
                      onSchedule={() => openSchedule(exception)}
                      onUnschedule={() =>
                        onAction("unschedule", exception.id, {
                          request_id: crypto.randomUUID(),
                          expected_version: exception.version,
                        })
                      }
                      onComplete={() =>
                        onAction("complete", exception.id, {
                          request_id: crypto.randomUUID(),
                          expected_version: exception.version,
                        })
                      }
                      onRestore={() =>
                        onAction("restore", exception.id, {
                          request_id: crypto.randomUUID(),
                          expected_version: exception.version,
                        })
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null,
        )}

        {/* Hoãn buổi học */}
        <section aria-label="Hoãn buổi học" className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Hoãn buổi học</h3>
          <p className="mt-1 text-[13px] leading-[18px] text-gray-500">
            Chọn khoảng ngày để xem các buổi học thực tế có thể hoãn (tối đa 120 ngày, chỉ buổi trong
            tương lai).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-[13px] font-medium text-gray-700">
              Từ
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={rangeFrom}
                maxLength={10}
                placeholder="YYYY-MM-DD"
                onChange={(event) => setRangeFrom(event.target.value)}
                aria-invalid={rangeFrom.length > 0 && !isValidIsoDate(rangeFrom)}
                className="ml-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </label>
            <label className="text-[13px] font-medium text-gray-700">
              Đến
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={rangeTo}
                maxLength={10}
                placeholder="YYYY-MM-DD"
                onChange={(event) => setRangeTo(event.target.value)}
                aria-invalid={rangeTo.length > 0 && !isValidIsoDate(rangeTo)}
                className="ml-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </label>
            {!isValidIsoDate(rangeFrom) || !isValidIsoDate(rangeTo) ? (
              <span role="alert" aria-live="polite" className="text-[13px] text-red-700">
                Nhập ngày dạng YYYY-MM-DD.
              </span>
            ) : null}
          </div>

          {occurrencesQuery.isError ? (
            <div className="mt-3">
              <DataSectionError
                title="Không tải được các buổi học"
                description={getApiErrorMessage(occurrencesQuery.error, "Vui lòng thử lại.")}
                onRetry={() => void occurrencesQuery.refetch()}
              />
            </div>
          ) : null}

          {previewOptions.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {previewOptions.map((option) => {
                const checked = selectedKeys.has(option.key);
                const disabled = !option.adjustable;
                return (
                  <li key={option.key}>
                    <label
                      className={cn(
                        "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2",
                        checked ? "border-primary/40 bg-primary-soft/50" : "border-gray-200",
                        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        autoComplete="off"
                        onChange={() => toggleOccurrence(option.key)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">
                          {formatDateTime(option.original_start_at)}
                        </span>
                        <span className="block text-[13px] leading-[18px] text-gray-600">
                          {option.already_adjusted
                            ? "Buổi này đã được hoãn trước đó."
                            : option.passed
                              ? "Buổi đã qua — dùng ghi nhận buổi đã hoãn."
                              : option.source_slot_key}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[13px] font-medium text-gray-700">
              Lý do hoãn
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value as MakeupReasonCode)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-medium text-gray-700">
              Ghi chú (tùy chọn)
              <input
                type="text"
                value={reasonNote}
                maxLength={500}
                autoComplete="off"
                onChange={(event) => setReasonNote(event.target.value)}
                placeholder="Chi tiết lý do hoãn..."
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-[13px] font-medium text-gray-700">Xếp bù</legend>
            <div className="mt-1 flex gap-4">
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-800">
                <input
                  type="radio"
                  checked={scheduleNow}
                  autoComplete="off"
                  onChange={() => setScheduleNow(true)}
                  className="h-4 w-4 accent-primary"
                />
                Xếp bù ngay
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-800">
                <input
                  type="radio"
                  checked={!scheduleNow}
                  autoComplete="off"
                  onChange={() => setScheduleNow(false)}
                  className="h-4 w-4 accent-primary"
                />
                Xếp sau
              </label>
            </div>
          </fieldset>
          <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-[18px] text-gray-600">
            <CloseCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            Hoãn buổi học <strong>không ảnh hưởng tài chính</strong>: học phí, kỳ thu và lịch tuần
            giữ nguyên. Giáo viên/trợ giảng buổi bù được kế thừa từ buổi gốc.
          </p>
          {formError ? (
            <p role="alert" aria-live="polite" className="mt-2 flex items-start gap-1.5 text-[13px] leading-[18px] text-red-700">
              <ErrorWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving || postponeMutation.isPending || selectedKeys.size === 0}
              onClick={submitPostpone}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"
            >
              {postponeMutation.isPending ? (
                <LoadingInline label="Đang hoãn" />
              ) : (
                `Hoãn ${selectedKeys.size > 0 ? `(${selectedKeys.size})` : ""}`
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Đóng
            </button>
          </div>
        </section>

        {/* Lịch sử đã hoàn tất */}
        {groupedExceptions.MAKEUP_COMPLETED.length > 0 ||
        groupedExceptions.RESTORED.length > 0 ||
        groupedExceptions.CANCELLED.length > 0 ? (
          <section aria-label="Buổi bù đã hoàn tất" className="mt-4">
            <h3 className="text-sm font-semibold text-gray-900">Đã hoàn tất</h3>
            <ul className="mt-1.5 space-y-2">
              {[...groupedExceptions.MAKEUP_COMPLETED, ...groupedExceptions.RESTORED, ...groupedExceptions.CANCELLED].map(
                (exception) => (
                  <ExceptionCard key={exception.id} exception={exception} isSaving={isSaving} />
                ),
              )}
            </ul>
          </section>
        ) : null}
      </div>

      {/* Footer cố định: schedule panel */}
      {scheduleTarget ? (
        <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Xếp lịch bù cho buổi {formatDateTime(scheduleTarget.original_start_at)}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[13px] font-medium text-gray-700">
                Thời lượng: <strong>{durationLabel(scheduleTarget)}</strong> (cố định bằng buổi gốc)
              </p>
              <p className="mt-1 text-[13px] text-gray-600">
                Giáo viên/trợ giảng:{" "}
                <strong>
                  {scheduleTarget.staff.map((item) => item.display_name).join(", ") || "—"}
                </strong>
              </p>
              <p className="mt-1 text-[13px] text-gray-600">
                Học viên đủ điều kiện: <strong>{scheduleTarget.eligible_student_count}</strong>
              </p>
            </div>
            <label className="text-[13px] font-medium text-gray-700">
              Ngày giờ bù
              <input
                ref={scheduleInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={scheduleTime}
                maxLength={16}
                placeholder="YYYY-MM-DD HH:MM"
                onChange={(event) => setScheduleTime(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              {parseScheduleTime(scheduleTime) !== null && schedulePreviewQuery.isPending ? (
                <span className="mt-1 block text-[13px] text-gray-500">Đang kiểm tra xung đột…</span>
              ) : null}
              {conflicts.length > 0 ? (
                <span role="alert" aria-live="polite" className="mt-1 block text-[13px] text-red-700">
                  {conflicts[0].message}
                </span>
              ) : parseScheduleTime(scheduleTime) !== null && schedulePreviewQuery.data?.can_schedule ? (
                <span role="status" aria-live="polite" className="mt-1 block text-[13px] text-emerald-700">
                  Khung giờ trống.
                </span>
              ) : scheduleTime.length > 0 && parseScheduleTime(scheduleTime) === null ? (
                <span role="alert" aria-live="polite" className="mt-1 block text-[13px] text-red-700">
                  Nhập ngày giờ dạng YYYY-MM-DD HH:MM.
                </span>
              ) : null}
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving || conflicts.length > 0 || parseScheduleTime(scheduleTime) === null}
              onClick={submitSchedule}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? <LoadingInline label="Đang lưu" /> : "Xếp buổi bù"}
            </button>
            <button
              type="button"
              onClick={() => setScheduleTarget(null)}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Hủy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function durationLabel(exception: ClassSessionExceptionResponse) {
  const start = new Date(exception.original_start_at);
  const end = new Date(exception.original_end_at);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60 ? `${minutes % 60} phút` : ""}`.trim();
}

function LoadingInline({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-live="polite">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

function ExceptionCard({
  exception,
  isSaving,
  onSchedule,
  onUnschedule,
  onComplete,
  onRestore,
}: {
  exception: ClassSessionExceptionResponse;
  isSaving: boolean;
  onSchedule?: () => void;
  onUnschedule?: () => void;
  onComplete?: () => void;
  onRestore?: () => void;
}) {
  const isAwaiting = exception.display_status === "AWAITING_CONFIRMATION";
  const canRestore = exception.status === "MAKEUP_PENDING" || exception.status === "MAKEUP_SCHEDULED";
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "inline-flex rounded-md px-2 py-0.5 text-[12px] font-semibold leading-4",
            isAwaiting
              ? "bg-orange-50 text-orange-700"
              : exception.status === "MAKEUP_PENDING"
                ? "bg-amber-50 text-amber-700"
                : exception.status === "MAKEUP_SCHEDULED"
                  ? "bg-sky-50 text-sky-700"
                  : exception.status === "MAKEUP_COMPLETED"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-600",
          )}
        >
          {STATUS_LABELS[exception.display_status]}
        </span>
        <span className="text-sm font-semibold text-gray-900">
          {formatDateTime(exception.original_start_at)}
        </span>
        {exception.replacement_start_at ? (
          <span className="text-[13px] text-gray-600">
            → bù lúc {formatDateTime(exception.replacement_start_at)}
          </span>
        ) : null}
      </div>
      {exception.status === "MAKEUP_PENDING" || exception.status === "MAKEUP_SCHEDULED" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onSchedule ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={onSchedule}
              className="inline-flex h-8 items-center rounded-md bg-primary-soft px-2.5 text-[13px] font-semibold text-primary transition hover:bg-primary-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"
            >
              {exception.status === "MAKEUP_SCHEDULED" ? "Đổi lịch bù" : "Xếp lịch bù"}
            </button>
          ) : null}
          {onUnschedule && exception.status === "MAKEUP_SCHEDULED" ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={onUnschedule}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"
            >
              Bỏ xếp lịch
            </button>
          ) : null}
          {onComplete && isAwaiting ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={onComplete}
              className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-2.5 text-[13px] font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30 disabled:cursor-wait disabled:opacity-60"
            >
              Xác nhận đã học bù
            </button>
          ) : null}
          {onRestore && canRestore ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={onRestore}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-60"
            >
              Khôi phục buổi gốc
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
