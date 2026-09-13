"use client";

import { useMemo, useState } from "react";
import { RiArrowDownSLine as ChevronDown } from "react-icons/ri";
import { DataSectionError } from "@/components/ui/data-section-state";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { EnrollmentResponse } from "@/lib/types";
import { buildStudentLearningHistoryLayout } from "./student-learning-history-layout";

const STATUS_LABELS: Record<EnrollmentResponse["status"], string> = {
  active: "Đang học",
  completed: "Đã hoàn thành",
  dropped: "Đã rời lớp",
  cancelled: "Đã huỷ",
};

function compactTime(value: string): string {
  return value.slice(0, 5);
}

function scheduleLabel(enrollment: EnrollmentResponse): string {
  if (enrollment.selected_slots.length === 0) {
    return "Chưa có dữ liệu lịch học";
  }
  return enrollment.selected_slots
    .map(
      (slot) =>
        `${slot.weekday} ${compactTime(slot.local_start)}–${compactTime(slot.local_end)}`,
    )
    .join(" · ");
}

function statusClasses(status: EnrollmentResponse["status"]): string {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border border-gray-300 bg-white text-gray-500 line-through";
  if (status === "dropped") return "border border-gray-300 bg-white text-gray-600";
  return "bg-gray-100 text-gray-600";
}

function historyNodeClasses(status: EnrollmentResponse["status"]): string {
  if (status === "active") {
    return "border-primary bg-gray-950";
  }
  if (status === "cancelled") {
    return "border-destructive bg-destructive";
  }
  return "border-primary bg-primary";
}

export function StudentLearningHistory({
  enrollments,
  isLoading,
  error,
  onRetry,
}: {
  enrollments: EnrollmentResponse[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const items = useMemo(
    () => buildStudentLearningHistoryLayout(enrollments),
    [enrollments],
  );

  if (isLoading) return <StudentLearningHistorySkeleton />;

  if (error) {
    return (
      <div className="min-h-0 flex-1 bg-gray-50 p-5">
        <DataSectionError
          title="Chưa tải được lịch sử học tập"
          description="Vui lòng thử lại. Hồ sơ học viên vẫn được giữ nguyên."
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      {items.length === 0 ? (
        <section className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          Học viên chưa từng được xếp lớp.
        </section>
      ) : (
        <ol className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="Các lớp học theo thời gian">
          {items.map((item, index) => {
            const { enrollment } = item;
            const expanded = expandedId === enrollment.id;
            return (
              <li
                key={enrollment.id}
                className={cn("relative", index > 0 && "border-t border-gray-100")}
              >
                {expanded && item.connectsToNext ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 left-[30px] top-16 w-px -translate-x-1/2 bg-gray-300 sm:left-9"
                  />
                ) : null}
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`learning-history-${enrollment.id}`}
                  onClick={() => setExpandedId(expanded ? null : enrollment.id)}
                  className="group grid min-h-16 w-full grid-cols-[36px_minmax(0,1fr)_auto] items-stretch gap-x-2 px-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:px-4"
                >
                  <span className="relative flex h-full items-center justify-center" aria-hidden="true">
                    {item.connectsToPrevious ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-1/2 top-0 left-1/2 w-px -translate-x-1/2 bg-gray-300"
                      />
                    ) : null}
                    {item.connectsToNext ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-0 top-1/2 left-1/2 w-px -translate-x-1/2 bg-gray-300"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 h-3.5 w-3.5 rounded-full border-2",
                        historyNodeClasses(enrollment.status),
                      )}
                    />
                  </span>

                  <span className="flex min-w-0 flex-col justify-center py-2.5">
                    <span className="block truncate text-[15px] font-semibold text-gray-950">
                      {enrollment.class_name}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-gray-500">
                      Bắt đầu {formatDate(enrollment.enrollment_date)}
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5 py-2.5 pl-2">
                    <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", statusClasses(enrollment.status))}>
                      {STATUS_LABELS[enrollment.status]}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-5 w-5 text-gray-400 transition-transform duration-200 motion-reduce:transition-none",
                        expanded && "rotate-180",
                      )}
                    />
                  </span>
                </button>

                {expanded ? (
                  <div
                    id={`learning-history-${enrollment.id}`}
                    className="ml-[51px] border-t border-gray-100 pb-4 pr-4 pt-3 sm:ml-[64px]"
                  >
                    <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-[13px] text-gray-500">Ngày ghi danh</dt>
                        <dd className="mt-0.5 font-medium text-gray-900">{formatDate(enrollment.enrollment_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-[13px] text-gray-500">Học phí áp dụng</dt>
                        <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 font-semibold tabular-nums text-gray-900">
                          {formatCurrency(enrollment.effective_fee)}
                          {enrollment.custom_fee !== null ? (
                            <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">Mức riêng</span>
                          ) : null}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-[13px] text-gray-500">Lịch học đã chọn</dt>
                        <dd className="mt-0.5 leading-5 text-gray-900">{scheduleLabel(enrollment)}</dd>
                      </div>
                      {enrollment.status !== "active" && enrollment.end_reason ? (
                        <div className="sm:col-span-2">
                          <dt className="text-[13px] text-gray-500">Lý do kết thúc</dt>
                          <dd className="mt-0.5 leading-5 text-gray-900">{enrollment.end_reason}</dd>
                        </div>
                      ) : null}
                      {enrollment.status !== "active" && enrollment.ended_at ? (
                        <div>
                          <dt className="text-[13px] text-gray-500">Ngày kết thúc</dt>
                          <dd className="mt-0.5 font-medium text-gray-900">{formatDate(enrollment.ended_at)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function StudentLearningHistorySkeleton() {
  return (
    <div aria-hidden="true" className="min-h-0 flex-1 bg-gray-50 px-5 py-4">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white motion-safe:animate-pulse">
        {[0, 1, 2].map((item) => (
          <div key={item} className={cn("grid min-h-16 grid-cols-[40px_minmax(0,1fr)_88px] items-center gap-2 px-4", item > 0 && "border-t border-gray-100")}>
            <div className="mx-auto h-3 w-3 rounded-full bg-gray-200" />
            <div>
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
            </div>
            <div className="h-6 rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
