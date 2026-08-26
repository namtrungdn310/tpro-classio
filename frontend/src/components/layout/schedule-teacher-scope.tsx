"use client";

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TeacherOptionResponse } from "@/lib/types";

interface ScheduleTeacherScopeProps {
  teachers: TeacherOptionResponse[];
  assistants?: TeacherOptionResponse[];
  /** null = Tổng quan (view-only). */
  activeTeacherId: string | null;
  onSelectTeacher: (id: string | null) => void;
  selectedSessionCount?: number;
  maxSessionCount?: number;
}

export function ScheduleTeacherScope({
  teachers,
  assistants = [],
  activeTeacherId,
  onSelectTeacher,
  selectedSessionCount = 0,
  maxSessionCount = 4,
}: ScheduleTeacherScopeProps) {
  const baseId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);
  const totalStaffCount = teachers.length + assistants.length;
  const showOverview = totalStaffCount !== 1;
  const options = [
    ...(showOverview ? [{ id: null as string | null, name: "Tổng quan", isAssistant: false }] : []),
    ...teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.full_name,
      isAssistant: false,
    })),
    ...assistants.map((assistant) => ({
      id: assistant.id,
      name: `${assistant.full_name} (TG)`,
      isAssistant: true,
    })),
  ];
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.id === activeTeacherId),
  );
  const activeOption =
    options.length === 1
      ? options[0]
      : options[activeIndex]?.id !== null
        ? options[activeIndex]
        : null;
  const activeName = activeOption?.name ?? null;

  useEffect(() => {
    tablistRef.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeIndex, showOverview]);

  const moveFocus = (index: number) => {
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`[data-teacher-scope-tab="${index}"]`)
      ?.focus({ preventScroll: true });
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = index === 0 ? options.length - 1 : index - 1;
    } else if (event.key === "ArrowRight") {
      nextIndex = index === options.length - 1 ? 0 : index + 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    onSelectTeacher(options[nextIndex].id);
    moveFocus(nextIndex);
  };

  return (
    <div className="border-b border-gray-200 bg-white px-3 py-1.5">
      <div className="flex items-center gap-2">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          role="tablist"
          ref={tablistRef}
          aria-label="Chọn giáo viên đang xếp lịch"
        >
        {options.map((option, index) => {
          const selected =
            option.id === activeTeacherId ||
            (!showOverview && options.length === 1);
          return (
            <button
              key={option.id ?? "overview"}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              data-teacher-scope-tab={String(index)}
              data-teacher-scope={option.id ?? "overview"}
              onClick={() => onSelectTeacher(option.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[12px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                selected
                  ? "border-primary/30 bg-primary-soft font-semibold text-primary"
                  : "border-transparent text-gray-600 hover:bg-slate-100 hover:text-gray-800"
              }`}
            >
              {option.name}
            </button>
          );
        })}
        {options.length === 0 ? (
          <span className="helper-text px-1 text-gray-500">
            Chưa chọn giáo viên nào cho lớp.
          </span>
        ) : null}
        </div>
        <span
          className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600"
          aria-label={`${selectedSessionCount} trên ${maxSessionCount} buổi đã chọn`}
        >
          {selectedSessionCount}/{maxSessionCount} buổi
        </span>
      </div>
      <p
        id={`${baseId}-panel`}
        role="tabpanel"
        tabIndex={-1}
        className="mt-1 flex min-h-4 items-center gap-1.5 px-1 text-[11px] font-medium leading-tight"
      >
        {activeName ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="text-primary">Đang xếp cho {activeName}</span>
            <span className="text-gray-500">· Ô xám là lịch đã bận.</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
            <span className="text-gray-600">Tổng quan lịch dạy · Chọn giáo viên hoặc trợ giảng để xem lịch chi tiết.</span>
          </>
        )}
      </p>
    </div>
  );
}
