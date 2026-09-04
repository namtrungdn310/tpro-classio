"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  RiArrowRightSLine as ChevronRight,
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
import { formatDate } from "@/lib/utils/format";
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
  const [nestedOverlayOpen, setNestedOverlayOpen] = useState(false);
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
      if (event.key === "Escape" && !nestedOverlayOpen) {
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
  }, [isOpen, nestedOverlayOpen, onClose]);

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
            <p className="mt-1 text-[13px] font-medium leading-5 text-gray-500">{historyStatusLabel(class_.effective_status)} · Bắt đầu {formatDate(class_.start_date)}{class_.stopped_on ? ` · Ngừng ${formatDate(class_.stopped_on)}` : ""}</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Đóng hồ sơ lớp" onClick={onClose} className="rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"><X className="h-5 w-5" /></button>
        </header>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? <div className="flex min-h-48 items-center justify-center text-sm text-gray-600"><LoadingLabel label="Đang tải lịch sử" /></div> : null}
          {errorMessage ? <DataSectionError title="Không tải được hồ sơ lớp" description={errorMessage} onRetry={onRetry} /> : null}
          {data && !errorMessage ? <ClassHistoryContent data={data} onNestedOverlayChange={setNestedOverlayOpen} /> : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** Shared class history content used by the slide-over and the workspace. */
export function ClassHistoryContent({ data, onNestedOverlayChange }: { data: ClassHistory; onNestedOverlayChange?: (open: boolean) => void }) {
  const [studentsPanelOpen, setStudentsPanelOpen] = useState(false);
  const activeCount = data.enrollments.filter((enrollment) => enrollment.status === "active").length;
  const completedCount = data.enrollments.filter((enrollment) => enrollment.status !== "active").length;
  const teacherCount = new Set(data.teachers.filter((event) => event.staff_type === "TEACHER").map((event) => event.teacher_id)).size;
  const assistantCount = new Set(data.teachers.filter((event) => event.staff_type === "ASSISTANT").map((event) => event.teacher_id)).size;
  const staffCount = new Set(data.teachers.map((event) => event.teacher_id)).size;
  useEffect(() => {
    onNestedOverlayChange?.(studentsPanelOpen);
    return () => onNestedOverlayChange?.(false);
  }, [onNestedOverlayChange, studentsPanelOpen]);
  return <div className="space-y-4 font-body-ui">
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/40">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Info label="Bắt đầu" value={formatDate(data.start_date)} />
        {data.stopped_on ? <Info label="Ngừng hoạt động" value={formatDate(data.stopped_on)} /> : null}
        <Info className="col-span-2" label="Lịch học" value={scheduleLabel(data)} />
      </div>
    </section>
    <HistorySection icon={CalendarCheck} title="Điều chỉnh buổi học">
      {data.adjustments.length ? (
        <ol className="space-y-3 border-l border-gray-200 pl-4">
          {data.adjustments.map((adjustment) => (
            <li key={adjustment.adjustment_id} className="relative before:absolute before:-left-5 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-amber-400">
              <p className="text-[15px] font-medium leading-5 text-gray-800">
                {adjustmentLabel(adjustment)}
              </p>
              <div className="mt-1.5 grid gap-1 text-[13px] leading-5">
                <p className="text-gray-600">
                  <span className="font-semibold text-gray-700">Buổi học:</span>{" "}
                  <span className="font-medium tabular-nums">{formatSessionRange(adjustment.original_start_at, adjustment.original_end_at)}</span>
                </p>
                {adjustment.replacement_start_at ? (
                  <p className="text-gray-600">
                    <span className="font-semibold text-gray-700">Lịch thay thế:</span>{" "}
                    <span className="font-medium tabular-nums">{formatSessionRange(adjustment.replacement_start_at, adjustment.replacement_end_at)}</span>
                  </p>
                ) : null}
              </div>
              {adjustment.reason_note ? (
                <p className="mt-1 text-[13px] font-normal leading-5 text-gray-600">
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
    <HistorySection icon={CalendarCheck} title="Lịch học và giáo viên theo buổi">
      {data.schedule_slots?.length ? (
        <ul className="divide-y divide-gray-200">
          {data.schedule_slots.map((slot) => (
            <li key={slot.slot_id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-5 text-gray-800">
                    {slot.day} · {slot.start}–{slot.end}
                  </p>
                  <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-500">
                    Áp dụng từ {formatDate(slot.effective_from)}
                    {slot.effective_until
                      ? ` · kết thúc ${formatDate(slot.effective_until)}`
                      : ""}
                  </p>
                </div>
                <div className="flex max-w-[58%] flex-wrap justify-end gap-1.5">
                  {slot.teachers.length ? (
                    slot.teachers.map((teacher) => (
                      <span
                        key={`${slot.slot_id}-${teacher.staff_id}`}
                        className="rounded-full bg-slate-100 px-2 py-1 text-[12px] font-medium leading-4 text-slate-700"
                      >
                        {teacher.staff_name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[13px] font-medium text-destructive">
                      Chưa phân công giáo viên
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyHistory text="Chưa có phân công giáo viên theo buổi." />
      )}
    </HistorySection>
    <section className="grid grid-cols-3 gap-2" aria-label="Tóm tắt hồ sơ lớp">
      <HistoryMetric label="Nhân sự" value={staffCount} detail={`${teacherCount} giáo viên · ${assistantCount} trợ giảng`} />
      <HistoryMetric label="Học viên" value={data.enrollments.length} detail="trong danh sách" />
      <HistoryMetric label="Đang học" value={activeCount} detail="học viên" />
    </section>
    <HistorySection icon={Staff} title="Nhân sự phụ trách">
      {data.teachers.length ? <ul className="divide-y divide-gray-200">{data.teachers.map((event, index) => <li key={`${event.teacher_id}-${event.occurred_at}-${index}`} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-[15px] font-medium leading-5 text-gray-800">{event.teacher_name}</p><p className="mt-0.5 text-[13px] font-medium leading-4 text-gray-500">{staffTypeLabel(event.staff_type)}</p></div><span className="shrink-0 text-right text-[13px] font-medium leading-5 text-gray-500">{event.event_type === "assigned" ? "Phân công" : "Kết thúc"}<span className="block font-normal">{formatEventDate(event.occurred_at)}</span></span></li>)}</ul> : <EmptyHistory text="Chưa có dữ liệu phân công nhân sự." />}
    </HistorySection>
    {data.enrollments.length ? (
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm shadow-gray-200/30">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setStudentsPanelOpen(true)}
          className="group flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Students aria-hidden="true" className="icon-system h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="font-ui block text-[15px] font-semibold leading-5 text-gray-900">Danh sách học viên</span>
            <span className="mt-0.5 block text-[13px] font-medium leading-4 text-gray-500">
              {activeCount} đang học · {completedCount} từng học
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="ml-auto h-5 w-5 shrink-0 text-gray-400 transition-colors group-hover:text-primary"
          />
        </button>
      </section>
    ) : (
      <HistorySection icon={Students} title="Danh sách học viên">
        <EmptyHistory text="Chưa có học viên trong lớp." />
      </HistorySection>
    )}
    <ClassEnrollmentHistorySlide
      activeCount={activeCount}
      completedCount={completedCount}
      enrollments={data.enrollments}
      isOpen={studentsPanelOpen}
      onClose={() => setStudentsPanelOpen(false)}
    />
    <HistorySection icon={BookOpen} title="Dòng thời gian lớp">
      {data.lifecycle_events.filter((event) => !["archived", "restored"].includes(event.event_type)).length ? <ol className="space-y-3 border-l border-gray-200 pl-4">{data.lifecycle_events.filter((event) => !["archived", "restored"].includes(event.event_type)).map((event, index) => <li key={`${event.event_type}-${event.occurred_at}-${index}`} className="relative before:absolute before:-left-5 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-gray-400"><p className="text-[15px] font-medium leading-5 text-gray-800">{lifecycleLabel(event.event_type)}</p>{event.previous_billing_cycle_weeks && event.next_billing_cycle_weeks ? <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-600">{event.previous_billing_cycle_weeks} → {event.next_billing_cycle_weeks} tuần</p> : null}{event.reason ? <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-600">{event.reason}</p> : null}<p className="mt-0.5 text-[13px] font-normal leading-4 text-gray-500">{formatEventDate(event.occurred_at)}</p></li>)}</ol> : <EmptyHistory text="Chưa có sự kiện lịch sử." />}
    </HistorySection>
  </div>;
}

function ClassEnrollmentHistorySlide({
  activeCount,
  completedCount,
  enrollments,
  isOpen,
  onClose,
}: {
  activeCount: number;
  completedCount: number;
  enrollments: ClassHistory["enrollments"];
  isOpen: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"active" | "former">("active");
  const [query, setQuery] = useState("");
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const backdropPointerDownRef = useRef(false);
  const titleId = useId();
  const searchId = useId();
  const { durationMs, isReady } = useSlidePanelMotion(panelRef, shouldRender);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setQuery("");
      setTab("active");
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
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
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

  if (!shouldRender || typeof document === "undefined") return null;
  const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
  const visibleEnrollments = enrollments.filter((enrollment) =>
    !normalizedQuery || enrollment.student_name.toLocaleLowerCase("vi-VN").includes(normalizedQuery),
  );
  const activeEnrollments = visibleEnrollments.filter((enrollment) => enrollment.status === "active");
  const formerEnrollments = visibleEnrollments.filter((enrollment) => enrollment.status !== "active");

  return createPortal(
    <div
      aria-hidden={!isOpen}
      className={cn("fixed inset-0 z-[80] flex justify-end", isOpen ? "pointer-events-auto" : "pointer-events-none")}
      inert={!isOpen}
    >
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 bg-black/35 transition-opacity motion-reduce:transition-none", isVisible ? "opacity-100" : "opacity-0")}
        style={getSlideBackdropStyle(durationMs)}
        onPointerDown={(event) => { backdropPointerDownRef.current = event.target === event.currentTarget; }}
        onPointerUp={(event) => {
          if (backdropPointerDownRef.current && event.target === event.currentTarget) onClose();
          backdropPointerDownRef.current = false;
        }}
        onPointerCancel={() => { backdropPointerDownRef.current = false; }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex h-full w-full max-w-[520px] flex-col bg-gray-50 shadow-2xl transition-transform motion-reduce:transition-none sm:w-[90vw]",
          isVisible ? "translate-x-0" : "translate-x-full",
        )}
        style={getSlidePanelStyle(durationMs)}
      >
        <header className="shrink-0 border-b border-gray-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-ui text-xl font-semibold leading-7 text-gray-950">Danh sách học viên</h2>
              <p className="mt-0.5 text-[13px] font-medium leading-5 text-gray-500">
                {activeCount} đang học · {completedCount} từng học
              </p>
            </div>
            <button ref={closeButtonRef} type="button" aria-label="Đóng danh sách học viên" onClick={onClose} className="rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"><X className="h-5 w-5" /></button>
          </div>
          <nav aria-label="Phạm vi danh sách học viên" className="mt-3 flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 scrollbar-hidden">
            <button
              type="button"
              aria-pressed={tab === "active"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setTab("active")}
              className={`font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                tab === "active"
                  ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                  : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Đang học
              <span className={`min-w-4 text-right text-[12px] font-semibold tabular-nums ${tab === "active" ? "text-primary" : "text-gray-500"}`}>
                {activeCount}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={tab === "former"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setTab("former")}
              className={`font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                tab === "former"
                  ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
                  : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
              Từng học
              <span className={`min-w-4 text-right text-[12px] font-semibold tabular-nums ${tab === "former" ? "text-primary" : "text-gray-500"}`}>
                {completedCount}
              </span>
            </button>
          </nav>
          <label className="sr-only" htmlFor={searchId}>
            {tab === "active" ? "Tìm học viên đang học" : "Tìm học viên từng học"}
          </label>
          <div className="relative mt-2.5">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id={searchId}
              autoComplete={savedInfoAutocomplete.disabled}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "active" ? "Tìm học viên đang học..." : "Tìm học viên từng học..."}
              className={cn(formTextControlClassName, "pl-9")}
            />
          </div>
        </header>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {tab === "active" ? (
            <EnrollmentListSection
              emptyText={normalizedQuery ? "Không có kết quả phù hợp." : "Chưa có học viên đang học."}
              enrollments={activeEnrollments}
              variant="active"
            />
          ) : (
            <EnrollmentListSection
              emptyText={normalizedQuery ? "Không có kết quả phù hợp." : "Chưa có học viên từng học."}
              enrollments={formerEnrollments}
              variant="former"
            />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function EnrollmentListSection({
  emptyText,
  enrollments,
  variant,
}: {
  emptyText: string;
  enrollments: ClassHistory["enrollments"];
  variant: "active" | "former";
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm shadow-gray-200/30">
      {enrollments.length ? (
        <ul className="divide-y divide-gray-200 px-4">
          {enrollments.map((enrollment) => (
            <li key={enrollment.enrollment_id} className="flex min-h-14 items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium leading-5 text-gray-800">{enrollment.student_name}</p>
                <p className="mt-0.5 text-[13px] font-medium leading-4 text-gray-500">
                  Vào lớp: {formatDate(enrollment.enrollment_date)}
                </p>
              </div>
              {variant === "former" ? (
                <span className="shrink-0 text-right text-[13px] font-medium leading-5 text-gray-500">
                  {formerEnrollmentLabel(enrollment)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-4"><EmptyHistory text={emptyText} /></div>
      )}
    </section>
  );
}

function HistorySection({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Staff; title: string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30"><h3 className="font-ui mb-3 flex items-center gap-2 text-[15px] font-semibold leading-5 text-gray-900"><Icon aria-hidden="true" className="icon-system h-[18px] w-[18px] text-gray-600" />{title}</h3>{children}</section>;
}
function HistoryMetric({ detail, label, value }: { detail: string; label: string; value: number }) {
  return <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5"><p className="table-heading-text text-gray-500">{label}</p><p className="metric-value mt-1 text-lg font-semibold leading-6 text-gray-950">{value}</p><p className="truncate text-xs font-medium leading-4 text-gray-500" title={detail}>{detail}</p></div>;
}
function Info({ className = "", label, value }: { className?: string; label: string; value: string }) { return <div className={className}><p className="table-heading-text text-gray-500">{label}</p><p className="mt-1 text-[15px] font-medium leading-5 text-gray-800">{value}</p></div>; }
function EmptyHistory({ text }: { text: string }) { return <p className="rounded-lg bg-gray-100/70 px-3 py-2.5 text-sm font-medium text-gray-500">{text}</p>; }
function staffTypeLabel(type: "TEACHER" | "ASSISTANT") { return type === "ASSISTANT" ? "Trợ giảng" : "Giáo viên"; }
function formerEnrollmentLabel(enrollment: ClassHistory["enrollments"][number]) {
  if (enrollment.ended_at) return `Kết thúc ${formatEventDate(enrollment.ended_at)}`;
  if (enrollment.status === "cancelled") return "Đã hủy";
  if (enrollment.status === "dropped") return "Đã rời lớp";
  return "Đã kết thúc";
}
function formatEventDate(value: string) { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)); }
function formatSessionRange(startValue: string, endValue: string | null) {
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return startValue;
  const date = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const startTime = timeFormatter.format(start);
  if (!endValue) return `${date} · ${startTime}`;
  const end = new Date(endValue);
  return `${date} · ${startTime}–${Number.isNaN(end.getTime()) ? endValue : timeFormatter.format(end)}`;
}
function lifecycleLabel(event: string) { return ({ created: "Mở lớp", identity_configured: "Hoàn tất phân loại", start_date_changed: "Đổi ngày bắt đầu", billing_cycle_changed: "Đổi thời lượng gói", stopped: "Ngừng hoạt động", cancelled: "Đã hủy lớp" } as Record<string, string>)[event] ?? "Cập nhật lớp"; }
function scheduleLabel(data: ClassHistory) {
  if (data.schedule?.slots?.length) return getClassScheduleSlotsLabel(data.schedule.slots);
  return data.schedule?.text?.trim() || "Chưa thiết lập";
}
function historyStatusLabel(status: ClassResponse["effective_status"]) {
  return ({ SCHEDULED: "Sắp mở", ACTIVE: "Đang học", LEGACY: "Dữ liệu cũ", STOPPED: "Đã ngừng", CANCELLED: "Đã hủy" } as Record<ClassResponse["effective_status"], string>)[status];
}

function adjustmentLabel(adjustment: ClassHistoryAdjustment) {
  const statusLabels: Record<ClassHistoryAdjustment["display_status"], string> = {
    MAKEUP_PENDING: "Đã hoãn buổi học",
    MAKEUP_SCHEDULED: "Đã hoãn — có lịch thay thế (lịch sử)",
    MAKEUP_COMPLETED: "Lịch thay thế đã hoàn tất (lịch sử)",
    RESTORED: "Khôi phục buổi gốc",
    CANCELLED: "Buổi hoãn đã hủy",
  };
  return statusLabels[adjustment.display_status] ?? "Điều chỉnh buổi học";
}
