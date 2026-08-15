"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  RiBookOpenLine as BookOpen,
  RiCalendarCheckLine as CalendarCheck,
  RiCloseLine as X,
  RiIdCardLine as Staff,
  RiSearchLine as Search,
  RiTeamLine as Students,
} from "react-icons/ri";
import { DataSectionError } from "@/components/ui/data-section-state";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  canRevealSlidePanel,
  getSlideBackdropStyle,
  getSlidePanelStyle,
  getSlidePanelUnmountDelay,
  useSlidePanelMotion,
} from "@/lib/ui/slide-panel-motion";
import type { ClassHistory, ClassHistoryAdjustment, ClassResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { getClassScheduleSlotsLabel } from "@/lib/classes/presentation";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";

export function ClassHistorySlide({
  class_,
  data,
  errorMessage,
  isLoading,
  onClose,
  onRetry,
}: {
  class_: ClassResponse | null;
  data: ClassHistory | undefined;
  errorMessage: string | null;
  isLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const isOpen = class_ !== null;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const backdropPointerDownRef = useRef(false);
  const titleId = useId();
  const { durationMs, isReady } = useSlidePanelMotion(panelRef, shouldRender);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      return;
    }
    setIsVisible(false);
    if (!shouldRender) return;
    const timer = window.setTimeout(
      () => setShouldRender(false),
      getSlidePanelUnmountDelay(durationMs, window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    return () => window.clearTimeout(timer);
  }, [durationMs, isOpen, shouldRender]);

  useEffect(() => {
    if (!canRevealSlidePanel({ isOpen, isReady, isRendered: shouldRender })) return;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setIsVisible(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isReady, shouldRender]);

  useEffect(() => {
    if (!isOpen) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeydown, true);
      document.body.style.overflow = priorOverflow;
      priorFocusRef.current?.focus({ preventScroll: true });
      priorFocusRef.current = null;
    };
  }, [isOpen, onClose]);

  if (!shouldRender || !class_ || typeof document === "undefined") return null;

  return createPortal(
    <div aria-hidden={!isOpen} className={cn("fixed inset-0 z-[70] flex justify-end", isOpen ? "pointer-events-auto" : "pointer-events-none")} inert={!isOpen}>
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 bg-black/35 transition-opacity motion-reduce:transition-none", isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}
        style={getSlideBackdropStyle(durationMs)}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => { backdropPointerDownRef.current = event.target === event.currentTarget; }}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (backdropPointerDownRef.current && event.target === event.currentTarget) onClose();
          backdropPointerDownRef.current = false;
        }}
        onPointerCancel={() => { backdropPointerDownRef.current = false; }}
      />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn("relative z-10 flex h-full w-full max-w-[720px] flex-col bg-gray-50 shadow-2xl transition-transform motion-reduce:transition-none sm:w-[90vw]", isVisible ? "translate-x-0" : "translate-x-full")} style={getSlidePanelStyle(durationMs)}>
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="table-heading-text text-gray-500">Hồ sơ lớp</p>
            <h2 id={titleId} className="font-ui mt-1 truncate text-xl font-semibold leading-7 text-gray-950">{class_.primary_label}</h2>
            {class_.secondary_label && (class_.grade_level || class_.academic_year_start) ? <p className="mt-0.5 text-[15px] font-medium leading-5 text-gray-600">{class_.secondary_label}</p> : null}
            <p className="mt-1 text-[13px] font-medium leading-5 text-gray-500">{historyStatusLabel(class_.effective_status)} · {formatDate(class_.start_date)} – {formatDate(class_.end_date)}</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Đóng hồ sơ lớp" onClick={onClose} className="rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"><X className="h-5 w-5" /></button>
        </header>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? <div className="flex min-h-48 items-center justify-center text-sm text-gray-600"><LoadingLabel label="Đang tải lịch sử" /></div> : null}
          {errorMessage ? <DataSectionError title="Không tải được hồ sơ lớp" description={errorMessage} onRetry={onRetry} /> : null}
          {data && !errorMessage ? <ClassHistoryContent data={data} /> : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** Shared class history content used by the slide-over and the workspace. */
export function ClassHistoryContent({ data }: { data: ClassHistory }) {
  const [studentQuery, setStudentQuery] = useState("");
  const normalizedStudentQuery = studentQuery.trim().toLocaleLowerCase("vi-VN");
  const visibleEnrollments = data.enrollments.filter((enrollment) =>
    !normalizedStudentQuery || enrollment.student_name.toLocaleLowerCase("vi-VN").includes(normalizedStudentQuery),
  );
  const activeCount = data.enrollments.filter((enrollment) => enrollment.status === "active").length;
  const completedCount = data.enrollments.filter((enrollment) => enrollment.status !== "active").length;
  const teacherCount = new Set(data.teachers.filter((event) => event.staff_type === "TEACHER").map((event) => event.teacher_id)).size;
  const assistantCount = new Set(data.teachers.filter((event) => event.staff_type === "ASSISTANT").map((event) => event.teacher_id)).size;
  const staffCount = new Set(data.teachers.map((event) => event.teacher_id)).size;
  return <div className="space-y-4 font-body-ui">
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/40">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Info label="Bắt đầu" value={formatDate(data.start_date)} />
        <Info label="Kết thúc" value={formatDate(data.end_date)} />
        <Info className="col-span-2" label="Lịch học" value={scheduleLabel(data)} />
      </div>
    </section>
    <section className="grid grid-cols-3 gap-2" aria-label="Tóm tắt hồ sơ lớp">
      <HistoryMetric label="Nhân sự" value={staffCount} detail={`${teacherCount} giáo viên · ${assistantCount} trợ giảng`} />
      <HistoryMetric label="Từng học" value={data.enrollments.length} detail="học viên" />
      <HistoryMetric label="Đang học" value={activeCount} detail="học viên" />
    </section>
    <HistorySection icon={Staff} title="Nhân sự phụ trách">
      {data.teachers.length ? <ul className="divide-y divide-gray-200">{data.teachers.map((event, index) => <li key={`${event.teacher_id}-${event.occurred_at}-${index}`} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-[15px] font-medium leading-5 text-gray-800">{event.teacher_name}</p><p className="mt-0.5 text-[13px] font-medium leading-4 text-gray-500">{staffTypeLabel(event.staff_type)}</p></div><span className="shrink-0 text-right text-[13px] font-medium leading-5 text-gray-500">{event.event_type === "assigned" ? "Phân công" : "Kết thúc"}<span className="block font-normal">{formatEventDate(event.occurred_at)}</span></span></li>)}</ul> : <EmptyHistory text="Chưa có dữ liệu phân công nhân sự." />}
    </HistorySection>
    <HistorySection icon={Students} title="Học viên từng học">
      {data.enrollments.length ? <>
        <p className="mb-2 text-[13px] font-medium text-gray-500">{activeCount} đang học · {completedCount} đã kết thúc</p>
        <label className="sr-only" htmlFor="class-history-student-search">Tìm học viên trong hồ sơ lớp</label>
        <div className="relative mb-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input id="class-history-student-search" autoComplete={savedInfoAutocomplete.disabled} value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Tìm học viên từng học..." className={cn(formTextControlClassName, "h-9 pl-9")} />
        </div>
        {visibleEnrollments.length ? <ul className="divide-y divide-gray-200">{visibleEnrollments.map((enrollment) => <li key={enrollment.enrollment_id} className="flex items-center justify-between gap-4 py-2.5"><div className="min-w-0"><p className="truncate text-[15px] font-medium leading-5 text-gray-800">{enrollment.student_name}</p><p className="mt-0.5 text-[13px] font-medium leading-4 text-gray-500">Vào lớp: {formatDate(enrollment.enrollment_date)}</p></div><span className={`shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold leading-4 ${enrollment.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{enrollment.ended_at ? `Kết thúc ${formatEventDate(enrollment.ended_at)}` : "Đang học"}</span></li>)}</ul> : <EmptyHistory text="Không tìm thấy học viên phù hợp." />}
      </> : <EmptyHistory text="Chưa có học viên trong lịch sử lớp." />}
    </HistorySection>
    <HistorySection icon={BookOpen} title="Dòng thời gian lớp">
      {data.lifecycle_events.filter((event) => !["archived", "restored"].includes(event.event_type)).length ? <ol className="space-y-3 border-l border-gray-200 pl-4">{data.lifecycle_events.filter((event) => !["archived", "restored"].includes(event.event_type)).map((event, index) => <li key={`${event.event_type}-${event.occurred_at}-${index}`} className="relative before:absolute before:-left-[21px] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-gray-400"><p className="text-[15px] font-medium leading-5 text-gray-800">{lifecycleLabel(event.event_type)}</p>{event.reason ? <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-600">{event.reason}</p> : null}<p className="mt-0.5 text-[13px] font-normal leading-4 text-gray-500">{formatEventDate(event.occurred_at)}</p></li>)}</ol> : <EmptyHistory text="Chưa có sự kiện lịch sử." />}
    </HistorySection>
    <HistorySection icon={CalendarCheck} title="Điều chỉnh buổi học">
      {data.adjustments.length ? (
        <ol className="space-y-3 border-l border-gray-200 pl-4">
          {data.adjustments.map((adjustment) => (
            <li key={adjustment.adjustment_id} className="relative before:absolute before:-left-[21px] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-amber-400">
              <p className="text-[15px] font-medium leading-5 text-gray-800">
                {adjustmentLabel(adjustment)}
              </p>
              <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-600">
                {formatDate(adjustment.original_start_at)} →{" "}
                {adjustment.replacement_start_at
                  ? formatDateTime(adjustment.replacement_start_at)
                  : "chưa xếp lịch bù"}
              </p>
              {adjustment.reason_note ? (
                <p className="mt-0.5 text-[13px] font-normal leading-5 text-gray-600">
                  {adjustment.reason_note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyHistory text="Chưa có buổi học nào được hoãn." />
      )}
    </HistorySection>
  </div>;
}

function HistorySection({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Staff; title: string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30"><h3 className="font-ui mb-3 flex items-center gap-2 text-[15px] font-semibold leading-5 text-gray-900"><Icon aria-hidden="true" className="icon-system h-[18px] w-[18px] text-gray-600" />{title}</h3>{children}</section>;
}
function HistoryMetric({ detail, label, value }: { detail: string; label: string; value: number }) {
  return <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5"><p className="table-heading-text text-gray-500">{label}</p><p className="metric-value mt-1 text-lg font-semibold leading-6 text-gray-950">{value}</p><p className="truncate text-[11px] font-medium leading-4 text-gray-500" title={detail}>{detail}</p></div>;
}
function Info({ className = "", label, value }: { className?: string; label: string; value: string }) { return <div className={className}><p className="table-heading-text text-gray-500">{label}</p><p className="mt-1 text-[15px] font-medium leading-5 text-gray-800">{value}</p></div>; }
function EmptyHistory({ text }: { text: string }) { return <p className="rounded-lg bg-gray-100/70 px-3 py-2.5 text-sm font-medium text-gray-500">{text}</p>; }
function staffTypeLabel(type: "TEACHER" | "ASSISTANT") { return type === "ASSISTANT" ? "Trợ giảng" : "Giáo viên"; }
function formatEventDate(value: string) { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)); }
function lifecycleLabel(event: string) { return ({ created: "Mở lớp", identity_configured: "Hoàn tất phân loại", end_date_changed: "Đổi ngày kết thúc", completed: "Lớp kết thúc", cancelled: "Đã hủy lớp" } as Record<string, string>)[event] ?? "Cập nhật lớp"; }
function scheduleLabel(data: ClassHistory) {
  if (data.schedule?.slots?.length) return getClassScheduleSlotsLabel(data.schedule.slots);
  return data.schedule?.text?.trim() || "Chưa thiết lập";
}
function historyStatusLabel(status: ClassResponse["effective_status"]) {
  return ({ SCHEDULED: "Sắp mở", ACTIVE: "Đang học", LEGACY: "Dữ liệu cũ", COMPLETED: "Đã kết thúc", CANCELLED: "Đã hủy" } as Record<ClassResponse["effective_status"], string>)[status];
}

function adjustmentLabel(adjustment: ClassHistoryAdjustment) {
  const statusLabels: Record<ClassHistoryAdjustment["display_status"], string> = {
    MAKEUP_PENDING: "Hoãn buổi học — chờ xếp lịch bù",
    MAKEUP_SCHEDULED: "Hoãn buổi học — đã xếp lịch bù",
    AWAITING_CONFIRMATION: "Buổi bù đã kết thúc — chờ xác nhận",
    MAKEUP_COMPLETED: "Buổi bù đã hoàn tất",
    RESTORED: "Khôi phục buổi gốc",
    CANCELLED: "Buổi hoãn đã hủy",
  };
  return statusLabels[adjustment.display_status] ?? "Điều chỉnh buổi học";
}
