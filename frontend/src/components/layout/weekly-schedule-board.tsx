"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClassResponse } from "@/lib/types";
import { getClassGroupInfoForRecord } from "@/lib/classes/presentation";
import { abbreviateClassName } from "@/lib/utils/class-groups";
import { SCHEDULE_BLOCK_COUNT } from "@/lib/classes/schedule-drag";
import {
  formatScheduleMinutes,
  getCurrentTimeMarkerTop,
  getVietnamScheduleClock,
  isScheduleIntervalPast,
  millisecondsUntilNextScheduleStep,
  parseScheduleTime,
} from "@/lib/classes/schedule-current-time";
import { cn } from "@/lib/utils";

export const DAYS_OF_WEEK = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ Nhật",
] as const;

export interface ScheduleSlot {
  day: (typeof DAYS_OF_WEEK)[number];
  start: string;
  end: string;
  /** Giáo viên phụ trách riêng buổi này (subset của teacher_ids của lớp). */
  teacher_ids?: string[];
  /** Trợ giảng hỗ trợ riêng buổi này (subset của assistant_ids của lớp). */
  assistant_ids?: string[];
  /** R6-D07: stable relational slot identity */
  id?: string;
  version?: number;
}

export interface ClassScheduleSlot extends ScheduleSlot {
  classId: string;
  className: string;
  classCategory: ClassResponse["class_category"];
  gradeLevel: number | null;
  teacherName?: string | null;
}

export const TIME_BLOCKS = Array.from({ length: SCHEDULE_BLOCK_COUNT }, (_, index) => {
  const hour = Math.floor(7 + index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

/** Display form of a time block label: "07:00" -> "7:00". */
export function formatTimeBlock(timeBlock: string) {
  return timeBlock.replace(/^0/, "");
}

const MAX_CONCURRENT_CLASSES = 2;
const TIME_COLUMN_WIDTH = 56;

interface WeeklyScheduleBoardProps {
  classes: ClassResponse[];
  detailDay?: string;
  className?: string;
  detailWidthClassName?: string;
  occurrencesByClass?: Map<string, EffectiveOccurrenceSummary["occurrences"]>;
}

export function WeeklyScheduleBoard({
  classes,
  className,
  detailDay = getTodayLabel(),
  detailWidthClassName = "lg:grid-cols-[minmax(0,1fr)_190px]",
  occurrencesByClass,
}: WeeklyScheduleBoardProps) {
  const [scheduleClock, setScheduleClock] = useState(() =>
    getVietnamScheduleClock(),
  );
  const refreshScheduleClock = useCallback(() => {
    setScheduleClock(getVietnamScheduleClock());
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNextUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshScheduleClock();
        scheduleNextUpdate();
      }, millisecondsUntilNextScheduleStep());
    };
    const resumeScheduleClock = () => {
      refreshScheduleClock();
      scheduleNextUpdate();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resumeScheduleClock();
    };
    scheduleNextUpdate();
    window.addEventListener("focus", resumeScheduleClock);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", resumeScheduleClock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshScheduleClock]);

  const scheduleSlots = useMemo(() => getClassScheduleSlots(classes), [classes]);
  const makeupMarkers = useMemo(
    () => buildMakeupMarkers(classes, occurrencesByClass),
    [classes, occurrencesByClass],
  );
  const detailSlots = useMemo(
    () =>
      scheduleSlots
        .filter((slot) => slot.day === detailDay)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)),
    [detailDay, scheduleSlots],
  );
  const positionedSlots = useMemo(
    () =>
      scheduleSlots.map((slot) => ({
        slot,
        ...getSlotStyle(slot, scheduleSlots),
      })),
    [scheduleSlots],
  );
  const detailSlotCount = detailSlots.length;
  const currentTimeMarkerTop = getCurrentTimeMarkerTop(scheduleClock);

  return (
    <div className={cn("dashboard-schedule-board grid min-h-[520px] gap-3 overflow-hidden", detailWidthClassName, className)}>
      <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white">
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="table-heading-text grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-slate-300 bg-slate-100 text-center text-slate-800">
          <div className="border-r border-slate-300 py-1">Giờ</div>
          {DAYS_OF_WEEK.map((day, dayIndex) => (
            <div
              key={day}
              aria-current={dayIndex === scheduleClock.dayIndex ? "date" : undefined}
              className={cn(
                "min-w-0 border-r border-slate-300 px-0.5 py-1 last:border-r-0",
                dayIndex === scheduleClock.dayIndex &&
                  "bg-primary-soft/70 font-semibold text-primary",
              )}
            >
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden" aria-hidden="true">{compactDayLabel(day)}</span>
            </div>
          ))}
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {TIME_BLOCKS.map((timeBlock, timeIndex) => (
            <div key={timeBlock} className="grid min-h-0 flex-1 grid-cols-[56px_repeat(7,minmax(0,1fr))] text-center text-xs">
              <div
                className={cn(
                  "font-ui flex items-center justify-center border-r border-slate-300 bg-slate-100 text-[12px] font-medium leading-3 text-slate-600",
                  timeIndex > 0 && "border-t border-slate-200",
                  scheduleClock.markerVisible &&
                    timeToMinutes(timeBlock) === scheduleClock.snappedMinutes &&
                    "font-semibold text-primary",
                )}
              >
                {formatTimeBlock(timeBlock)}
              </div>
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day}
                  className={`${timeIndex === 0 ? "" : "border-t border-slate-200"} border-r border-slate-200 last:border-r-0`}
                />
              ))}
            </div>
          ))}

          {currentTimeMarkerTop !== null ? (
            <>
              <div
                aria-hidden="true"
                data-dashboard-current-time
                className="pointer-events-none absolute z-30 h-0.5 bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.75)] transition-[top] duration-200 ease-out motion-reduce:transition-none"
                style={{
                  left: `calc(${TIME_COLUMN_WIDTH}px + ((100% - ${TIME_COLUMN_WIDTH}px) / 7) * ${scheduleClock.dayIndex})`,
                  top: `${currentTimeMarkerTop}%`,
                  width: `calc((100% - ${TIME_COLUMN_WIDTH}px) / 7)`,
                  transform: "translateY(-50%)",
                }}
              >
                <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-white" />
              </div>
              <span className="sr-only">
                Thời gian hiện tại {scheduleClock.label}, {DAYS_OF_WEEK[scheduleClock.dayIndex]}
              </span>
            </>
          ) : null}

          {positionedSlots.map(({ slot, color, style }, index) => {
            const postponed = makeupMarkers.postponed.get(
              `${slot.classId}|${slot.day}|${slot.start}`,
            );
            const dayIndex = DAYS_OF_WEEK.indexOf(slot.day);
            const isPast = isScheduleIntervalPast(
              dayIndex,
              timeToMinutes(slot.end),
              scheduleClock,
            );

            return (
              <div
                key={`${slot.classId}-${slot.day}-${slot.start}-${slot.end}-${index}`}
                title={`${slot.className}${slot.teacherName ? ` - ${slot.teacherName}` : ""} (${slot.start}-${slot.end})${postponed ? " - Đã hoãn" : ""}`}
                aria-label={`${slot.className}${slot.teacherName ? `, ${slot.teacherName}` : ""}, ${slot.start} đến ${slot.end}${postponed ? ", đã hoãn" : ""}${isPast ? ", đã qua" : ""}`}
                data-schedule-past={isPast ? "true" : undefined}
                className="font-ui absolute z-10 flex items-center justify-center rounded-md border px-1 text-center text-[10px] font-semibold leading-tight shadow-sm transition-[opacity,filter] duration-200 motion-reduce:transition-none"
                style={{
                  ...style,
                  backgroundColor: postponed ? color.background : color.background,
                  borderColor: color.border,
                  color: color.text,
                  opacity: postponed ? 0.55 : isPast ? 0.5 : 1,
                  filter: isPast && !postponed ? "saturate(0.4)" : undefined,
                  boxShadow: isPast ? "none" : undefined,
                }}
              >
                <span className="line-clamp-2" aria-hidden="true">
                  {postponed ? "Hoãn" : abbreviateClassName(slot.className, 20)}
                </span>
                {postponed ? (
                  <span className="sr-only">Buổi này đã hoãn</span>
                ) : null}
              </div>
            );
          })}

          {makeupMarkers.makeups.map((marker) => {
            const syntheticSlot: ClassScheduleSlot = {
              day: marker.day,
              start: marker.start,
              end: marker.end,
              classId: marker.classId,
              className: marker.className,
              classCategory: marker.classCategory,
              gradeLevel: marker.gradeLevel,
            };
            const { color, style } = getSlotStyle(syntheticSlot, scheduleSlots);
            const isPast = isScheduleIntervalPast(
              DAYS_OF_WEEK.indexOf(marker.day),
              timeToMinutes(marker.end),
              scheduleClock,
            );
            return (
              <div
                key={marker.key}
                title={`Học bù: ${marker.className} (${marker.start}-${marker.end})`}
                aria-label={`Học bù, ${marker.className}, ${marker.start} đến ${marker.end}${isPast ? ", đã qua" : ""}`}
                data-schedule-past={isPast ? "true" : undefined}
                className="font-ui absolute z-20 flex items-center justify-center rounded-md border border-dashed px-1 text-center text-[10px] font-semibold leading-tight transition-[opacity,filter] duration-200 motion-reduce:transition-none"
                style={{
                  ...style,
                  backgroundColor: color.background,
                  borderColor: color.border,
                  color: color.text,
                  opacity: isPast ? 0.5 : 1,
                  filter: isPast ? "saturate(0.4)" : undefined,
                }}
              >
                <span className="line-clamp-2">Học bù</span>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col rounded-lg border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-3 py-3">
          <h3 className="section-title-text text-gray-900">
            {detailDay} - {detailSlotCount} ca
          </h3>
        </div>
        {detailSlots.length === 0 ? (
          <p className="helper-text px-3 py-3 text-slate-600">
            Không có ca học trong ngày này.
          </p>
        ) : (
          <div className="scrollbar-hidden flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {detailSlots.map((slot, index) => {
              const color = getClassGroupInfoForRecord({
                name: slot.className,
                class_category: slot.classCategory,
                grade_level: slot.gradeLevel,
              } as ClassResponse).color;
              const isPast = isScheduleIntervalPast(
                DAYS_OF_WEEK.indexOf(slot.day),
                timeToMinutes(slot.end),
                scheduleClock,
              );

              return (
                <div
                  key={`${slot.classId}-${slot.start}-${slot.end}-${index}`}
                  title={slot.className}
                  aria-label={`${slot.className}, ${slot.start} đến ${slot.end}${isPast ? ", đã qua" : ""}`}
                  data-schedule-past={isPast ? "true" : undefined}
                  className="rounded-md border px-2 py-2 transition-[opacity,filter] duration-200 motion-reduce:transition-none"
                  style={{
                    backgroundColor: color.background,
                    borderColor: color.border,
                    color: color.text,
                    opacity: isPast ? 0.5 : 1,
                    filter: isPast ? "saturate(0.4)" : undefined,
                  }}
                >
                  <p className="truncate text-sm font-semibold">{slot.className}</p>
                  <p className="mt-1 text-xs font-medium opacity-80">
                    {slot.start}-{slot.end}{slot.teacherName ? ` · ${slot.teacherName}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}

export function WeeklyScheduleBoardSkeleton({
  className,
  detailWidthClassName = "lg:grid-cols-[minmax(0,1fr)_190px]",
}: {
  className?: string;
  detailWidthClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-[520px] animate-pulse gap-3 overflow-hidden",
        detailWidthClassName,
        className,
      )}
    >
      <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white">
        <div className="flex h-full min-h-[518px] min-w-0 flex-col overflow-hidden">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-slate-300 bg-slate-100 text-center">
          <div className="border-r border-slate-300 px-3 py-2">
            <div className="h-3 rounded bg-gray-200" />
          </div>
          {DAYS_OF_WEEK.map((day) => (
            <div key={day} className="min-w-0 border-r border-slate-300 px-1 py-2 last:border-r-0">
              <div className="mx-auto h-3 max-w-[56px] rounded bg-gray-200" />
            </div>
          ))}
        </div>

        <div className="relative flex flex-1 flex-col">
          {TIME_BLOCKS.map((timeBlock, timeIndex) => (
            <div key={timeBlock} className="grid flex-1 grid-cols-[56px_repeat(7,minmax(0,1fr))] text-center text-xs">
              <div
                className={`flex items-center justify-center border-r border-slate-300 bg-slate-100 px-2 ${
                  timeIndex > 0 ? "border-t border-slate-200" : ""
                }`}
              >
                <div className="h-3 w-10 rounded bg-gray-200" />
              </div>
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day}
                  className={`${timeIndex === 0 ? "" : "border-t border-slate-200"} border-r border-slate-200 last:border-r-0`}
                />
              ))}
            </div>
          ))}

          {[
            { dayIndex: 0, top: "30%", height: "9%" },
            { dayIndex: 1, top: "38%", height: "9%" },
            { dayIndex: 2, top: "30%", height: "9%" },
            { dayIndex: 4, top: "48%", height: "9%" },
            { dayIndex: 5, top: "66%", height: "10%" },
          ].map((slot, index) => (
            <div
              key={index}
              className="absolute rounded-md border border-slate-300 bg-slate-100 shadow-sm"
              style={{
                left: `calc(${TIME_COLUMN_WIDTH}px + ((100% - ${TIME_COLUMN_WIDTH}px) / 7) * ${slot.dayIndex} + 4px)`,
                top: `calc(${slot.top} + 2px)`,
                width: `calc(((100% - ${TIME_COLUMN_WIDTH}px) / 7) - 8px)`,
                height: `calc(${slot.height} - 4px)`,
              }}
            />
          ))}
        </div>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col rounded-lg border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-3 py-3">
          <div className="h-5 w-24 rounded bg-gray-200" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <div className="h-4 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-3/4 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function getClassScheduleSlots(classes: ClassResponse[]): ClassScheduleSlot[] {
  return classes.flatMap((class_) =>
    extractScheduleSlots(class_)
      .filter((slot) => DAYS_OF_WEEK.includes(slot.day))
      .map((slot) => ({
        ...slot,
        classId: class_.id,
        className: class_.primary_label,
        classCategory: class_.class_category,
        gradeLevel: class_.grade_level,
        teacherName: getClassTeacherNames(class_).join(", ") || null,
      })),
  );
}

function getClassTeacherNames(class_: ClassResponse): string[] {
  return class_.teacher_names?.length ? class_.teacher_names : class_.teacher_name ? [class_.teacher_name] : [];
}

type EffectiveOccurrenceSummary = {
  class_id: string;
  occurrences: Array<{
    key: string;
    kind: "REGULAR" | "POSTPONED" | "MAKEUP";
    original_start_at: string;
    original_end_at: string;
    source_slot_key: string;
    exception_id: string | null;
    status: string | null;
    replacement_start_at: string | null;
    replacement_end_at: string | null;
  }>;
};

function buildMakeupMarkers(
  classes: ClassResponse[],
  occurrencesByClass?: Map<string, EffectiveOccurrenceSummary["occurrences"]>,
): {
  postponed: Map<string, string>;
  makeups: Array<{
    key: string;
    classId: string;
    className: string;
    classCategory: ClassResponse["class_category"];
    gradeLevel: number | null;
    day: ScheduleSlot["day"];
    start: string;
    end: string;
  }>;
} {
  const postponed = new Map<string, string>();
  const makeups: ReturnType<typeof buildMakeupMarkers>["makeups"] = [];
  if (!occurrencesByClass) {
    return { postponed, makeups };
  }
  const classById = new Map(classes.map((class_) => [class_.id, class_]));
  for (const [classId, occurrences] of occurrencesByClass) {
    const class_ = classById.get(classId);
    if (!class_) {
      continue;
    }
    for (const occurrence of occurrences) {
      if (occurrence.kind === "MAKEUP" && occurrence.replacement_start_at) {
        const start = new Date(occurrence.replacement_start_at);
        const end = new Date(occurrence.replacement_end_at ?? occurrence.replacement_start_at);
        const startClock = getVietnamScheduleClock(start);
        const endClock = getVietnamScheduleClock(end);
        const day = DAYS_OF_WEEK[startClock.dayIndex];
        const startLabel = formatScheduleMinutes(startClock.minutes);
        const endLabel = formatScheduleMinutes(endClock.minutes);
        makeups.push({
          key: occurrence.key,
          classId,
          className: class_.primary_label,
          classCategory: class_.class_category,
          gradeLevel: class_.grade_level,
          day,
          start: startLabel,
          end: endLabel,
        });
      }
      if (
        occurrence.kind === "POSTPONED" &&
        occurrence.source_slot_key &&
        occurrence.status &&
        occurrence.status !== "RESTORED"
      ) {
        const [day, start] = occurrence.source_slot_key.split("|");
        if (day && start) {
          postponed.set(`${classId}|${day}|${start}`, occurrence.key);
        }
      }
    }
  }
  return { postponed, makeups };
}

export function getTodayLabel(value: Date | number = Date.now()) {
  return DAYS_OF_WEEK[getVietnamScheduleClock(value).dayIndex];
}

function extractScheduleSlots(class_: ClassResponse): ScheduleSlot[] {
  const schedule = class_.schedule as { slots?: ScheduleSlot[] } | null;
  return Array.isArray(schedule?.slots) ? schedule.slots : [];
}

function getSlotStyle(slot: ClassScheduleSlot, allSlots: ClassScheduleSlot[]) {
  const gridStart = timeToMinutes(TIME_BLOCKS[0]);
  const gridEnd = timeToMinutes(TIME_BLOCKS[TIME_BLOCKS.length - 1]) + 30;
  const gridDuration = gridEnd - gridStart;
  const slotStart = Math.max(gridStart, timeToMinutes(slot.start));
  const slotEnd = Math.min(gridEnd, timeToMinutes(slot.end));
  const dayIndex = DAYS_OF_WEEK.indexOf(slot.day);
  const color = getClassGroupInfoForRecord({
    name: slot.className,
    class_category: slot.classCategory,
    grade_level: slot.gradeLevel,
  } as ClassResponse).color;
  const overlappingSlots = allSlots.filter((other) => {
    if (other.day !== slot.day) return false;
    const otherStart = timeToMinutes(other.start);
    const otherEnd = timeToMinutes(other.end);
    return otherStart < slotEnd && slotStart < otherEnd;
  });
  const laneCount = Math.min(MAX_CONCURRENT_CLASSES, Math.max(1, overlappingSlots.length));
  const laneIndex = Math.max(
    0,
    overlappingSlots.findIndex(
      (other) =>
        other.classId === slot.classId &&
        other.day === slot.day &&
        other.start === slot.start &&
        other.end === slot.end,
    ),
  );
  const normalizedLaneIndex = Math.min(laneIndex, laneCount - 1);

  return {
    color,
    style: {
      left: `calc(${TIME_COLUMN_WIDTH}px + ((100% - ${TIME_COLUMN_WIDTH}px) / 7) * ${dayIndex} + 4px + (((100% - ${TIME_COLUMN_WIDTH}px) / 7 - 8px) / ${laneCount}) * ${normalizedLaneIndex})`,
      top: `calc(${((slotStart - gridStart) / gridDuration) * 100}% + 2px)`,
      width: `calc(((100% - ${TIME_COLUMN_WIDTH}px) / 7 - 8px) / ${laneCount} - 2px)`,
      height: `calc(${((slotEnd - slotStart) / gridDuration) * 100}% - 4px)`,
    },
  };
}

function timeToMinutes(value: string) {
  return parseScheduleTime(value);
}

function compactDayLabel(day: (typeof DAYS_OF_WEEK)[number]) {
  return day === "Chủ Nhật" ? "CN" : day.replace("Thứ ", "T");
}
