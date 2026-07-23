"use client";

import { useMemo } from "react";
import type { ClassResponse } from "@/lib/types";
import { abbreviateClassName, getClassGroupInfo } from "@/lib/utils/class-groups";
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
}

export interface ClassScheduleSlot extends ScheduleSlot {
  classId: string;
  className: string;
  teacherName?: string | null;
}

export const TIME_BLOCKS = Array.from({ length: 30 }, (_, index) => {
  const hour = Math.floor(7 + index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

const MAX_CONCURRENT_CLASSES = 2;
const TIME_COLUMN_WIDTH = 56;

interface WeeklyScheduleBoardProps {
  classes: ClassResponse[];
  detailDay?: string;
  className?: string;
  detailWidthClassName?: string;
}

export function WeeklyScheduleBoard({
  classes,
  className,
  detailDay = getTodayLabel(),
  detailWidthClassName = "lg:grid-cols-[minmax(0,1fr)_190px]",
}: WeeklyScheduleBoardProps) {
  const scheduleSlots = useMemo(() => getClassScheduleSlots(classes), [classes]);
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

  return (
    <div className={cn("grid min-h-[520px] gap-3 overflow-hidden", detailWidthClassName, className)}>
      <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex h-full min-h-[518px] min-w-0 flex-col overflow-hidden">
        <div className="table-heading-text grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-gray-200 bg-gray-50 text-center text-gray-700">
          <div className="border-r border-gray-200 py-2">Giờ</div>
          {DAYS_OF_WEEK.map((day) => (
            <div key={day} className="min-w-0 border-r border-gray-200 px-0.5 py-2 last:border-r-0">
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden" aria-hidden="true">{compactDayLabel(day)}</span>
            </div>
          ))}
        </div>

        <div className="relative flex flex-1 flex-col">
          {TIME_BLOCKS.map((timeBlock, timeIndex) => (
            <div key={timeBlock} className="grid flex-1 grid-cols-[56px_repeat(7,minmax(0,1fr))] text-center text-xs">
              <div
                className={`caption-text flex items-center justify-center border-r border-gray-200 bg-gray-50 text-gray-600 ${
                  timeIndex > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                {timeBlock}
              </div>
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day}
                  className={`${timeIndex === 0 ? "" : "border-t"} border-r border-gray-100 last:border-r-0`}
                />
              ))}
            </div>
          ))}

          {positionedSlots.map(({ slot, color, style }, index) => {

            return (
              <div
                key={`${slot.classId}-${slot.day}-${slot.start}-${slot.end}-${index}`}
                title={`${slot.className}${slot.teacherName ? ` - ${slot.teacherName}` : ""} (${slot.start}-${slot.end})`}
                aria-label={`${slot.className}${slot.teacherName ? `, ${slot.teacherName}` : ""}, ${slot.start} đến ${slot.end}`}
                className="font-ui absolute z-10 flex items-center justify-center rounded-md border px-1 text-center text-[10px] font-semibold leading-tight shadow-sm"
                style={{
                  ...style,
                  backgroundColor: color.background,
                  borderColor: color.border,
                  color: color.text,
                }}
              >
                <span className="line-clamp-2" aria-hidden="true">
                  {abbreviateClassName(slot.className)}
                </span>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-3 py-3">
          <h3 className="section-title-text text-gray-900">
            {detailDay} - {detailSlotCount} ca
          </h3>
        </div>
        {detailSlots.length === 0 ? (
          <p className="helper-text px-3 py-3 italic text-gray-400">Không có ca.</p>
        ) : (
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {detailSlots.map((slot, index) => {
              const color = getClassGroupInfo(slot.className).color;

              return (
                <div
                  key={`${slot.classId}-${slot.start}-${slot.end}-${index}`}
                  title={slot.className}
                  className="rounded-md border px-2 py-2"
                  style={{
                    backgroundColor: color.background,
                    borderColor: color.border,
                    color: color.text,
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
      <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex h-full min-h-[518px] min-w-0 flex-col overflow-hidden">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-gray-200 bg-gray-50 text-center">
          <div className="border-r border-gray-200 px-3 py-2">
            <div className="h-3 rounded bg-gray-200" />
          </div>
          {DAYS_OF_WEEK.map((day) => (
            <div key={day} className="min-w-0 border-r border-gray-200 px-1 py-2 last:border-r-0">
              <div className="mx-auto h-3 max-w-[56px] rounded bg-gray-200" />
            </div>
          ))}
        </div>

        <div className="relative flex flex-1 flex-col">
          {TIME_BLOCKS.map((timeBlock, timeIndex) => (
            <div key={timeBlock} className="grid flex-1 grid-cols-[56px_repeat(7,minmax(0,1fr))] text-center text-xs">
              <div
                className={`flex items-center justify-center border-r border-gray-200 bg-gray-50 px-2 ${
                  timeIndex > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <div className="h-3 w-10 rounded bg-gray-200" />
              </div>
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day}
                  className={`${timeIndex === 0 ? "" : "border-t"} border-r border-gray-100 last:border-r-0`}
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
              className="absolute rounded-md border border-gray-200 bg-gray-100 shadow-sm"
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

      <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-3 py-3">
          <div className="h-5 w-24 rounded bg-gray-200" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
              <div className="h-4 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-3/4 rounded bg-gray-100" />
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
        className: class_.name,
        teacherName: getClassTeacherNames(class_).join(", ") || null,
      })),
  );
}

function getClassTeacherNames(class_: ClassResponse): string[] {
  return class_.teacher_names?.length ? class_.teacher_names : class_.teacher_name ? [class_.teacher_name] : [];
}

export function getTodayLabel() {
  const day = new Date().getDay();
  if (day === 0) {
    return "Chủ Nhật";
  }

  return `Thứ ${day + 1}`;
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
  const color = getClassGroupInfo(slot.className).color;
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
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function compactDayLabel(day: (typeof DAYS_OF_WEEK)[number]) {
  return day === "Chủ Nhật" ? "CN" : day.replace("Thứ ", "T");
}
