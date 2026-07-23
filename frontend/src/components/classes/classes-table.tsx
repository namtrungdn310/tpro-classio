"use client";

import { Pencil, Trash2 } from "lucide-react";
import { ClassScheduleList } from "@/components/classes/class-schedule-list";
import type { ClassResponse } from "@/lib/types";
import {
  getClassBillingDurationLabel,
  getClassScheduleSlots,
  getClassScheduleSummary,
  getClassTeacherNames,
} from "@/lib/classes/presentation";
import { getClassGroupInfo } from "@/lib/utils/class-groups";
import { formatCurrency } from "@/lib/utils/format";

const ADMIN_GRID =
  "w-full min-w-0 grid-cols-[minmax(160px,1.4fr)_minmax(105px,.85fr)_minmax(100px,.8fr)_minmax(170px,1.35fr)_minmax(460px,500px)_78px]";
const VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(160px,1.4fr)_minmax(105px,.85fr)_minmax(100px,.8fr)_minmax(170px,1.35fr)_minmax(460px,500px)]";

type ClassesTableProps = {
  classes: ClassResponse[];
  isAdmin: boolean;
  onArchive: (class_: ClassResponse) => void;
  onEdit: (class_: ClassResponse) => void;
  selectedDay: string;
};

export function ClassesTable({
  classes,
  isAdmin,
  onArchive,
  onEdit,
  selectedDay,
}: ClassesTableProps) {
  return (
    <div className="h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div
        role="table"
        aria-label="Danh sách lớp học đang hoạt động"
        className="flex h-full min-h-0 w-full min-w-0 flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div
            role="row"
            className={`grid ${isAdmin ? ADMIN_GRID : VIEWER_GRID} table-heading-text items-center text-left text-gray-700`}
          >
            <ColumnHeader>Tên lớp</ColumnHeader>
            <ColumnHeader>Học phí</ColumnHeader>
            <ColumnHeader>Chu kỳ thu</ColumnHeader>
            <ColumnHeader>Giáo viên</ColumnHeader>
            <ColumnHeader>Lịch học</ColumnHeader>
            {isAdmin ? <ColumnHeader compact>Thao tác</ColumnHeader> : null}
          </div>
        </div>

        <div
          role="rowgroup"
          className="scrollbar-hidden min-h-0 flex-1 touch-pan-y divide-y divide-gray-100 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {classes.map((class_) => {
            const group = getClassGroupInfo(class_.name);
            const teacherNames = getClassTeacherNames(class_);
            return (
              <div
                key={class_.id}
                role="row"
                className={`cv-auto grid ${isAdmin ? ADMIN_GRID : VIEWER_GRID} items-center transition-colors hover:bg-gray-50/80`}
              >
                <DataCell className="font-semibold text-gray-950">
                  <div className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color.border }}
                      />
                      <span className="min-w-0 break-words">{class_.name}</span>
                    </span>
                    <span className="mt-0.5 block whitespace-nowrap pl-4 text-[13px] font-medium leading-4 text-gray-500">
                      Học viên: <span className="tabular-nums text-gray-600">{class_.student_count}</span>
                    </span>
                  </div>
                </DataCell>
                <DataCell className="metric-money tabular-nums text-gray-800">
                  {formatCurrency(class_.base_fee)}
                </DataCell>
                <DataCell className="whitespace-nowrap text-gray-700">
                  {getClassBillingDurationLabel(class_)}
                </DataCell>
                <DataCell className="min-w-0 text-gray-700">
                  {teacherNames.length > 0 ? (
                    <span className="block break-words">
                      {teacherNames.join(", ")}
                    </span>
                  ) : (
                    <EmptyValue />
                  )}
                </DataCell>
                <DataCell className="min-w-0 text-gray-700">
                  <ScheduleValue class_={class_} selectedDay={selectedDay} />
                </DataCell>
                {isAdmin ? (
                  <DataCell compact>
                    <div className="flex items-center gap-1.5">
                      <IconButton label={`Sửa lớp ${class_.name}`} onClick={() => onEdit(class_)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Ngừng hoạt động lớp ${class_.name}`}
                        tone="danger"
                        onClick={() => onArchive(class_)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </DataCell>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScheduleValue({ class_, selectedDay }: { class_: ClassResponse; selectedDay: string }) {
  const allSlots = getClassScheduleSlots(class_);
  const matchingSlots = selectedDay
    ? allSlots.filter((slot) => slot.day === selectedDay)
    : allSlots;
  const fullText = getClassScheduleSummary(class_, { day: selectedDay || undefined });

  if (matchingSlots.length === 0) {
    return fullText === "—" ? (
      <EmptyValue />
    ) : (
      <span className="break-words text-[15px] font-medium leading-5 text-gray-700">{fullText}</span>
    );
  }

  return (
    <ClassScheduleList
      activeDay={selectedDay || undefined}
      maxVisibleSlots={4}
      slots={allSlots}
    />
  );
}

function ColumnHeader({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div role="columnheader" className={`select-none whitespace-nowrap py-3 ${compact ? "px-2" : "px-2.5"}`}>
      {children}
    </div>
  );
}

function DataCell({ children, className = "", compact = false }: { children: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <div role="cell" className={`min-w-0 py-3 text-[15px] font-medium leading-5 ${compact ? "px-2" : "px-2.5"} ${className}`}>
      {children}
    </div>
  );
}

function EmptyValue() {
  return <span aria-label="Chưa có thông tin" className="select-none font-normal text-gray-400">—</span>;
}

function IconButton({ children, label, onClick, tone = "default" }: { children: React.ReactNode; label: string; onClick: () => void; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={
        tone === "danger"
          ? "inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-600 bg-red-600 text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          : "inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200"
      }
    >
      {children}
    </button>
  );
}

export function ClassesSkeleton({ isAdmin }: { isAdmin: boolean }) {
  const columnCount = isAdmin ? 6 : 5;

  return (
    <div aria-hidden="true" className="h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white animate-pulse">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className={`grid ${isAdmin ? ADMIN_GRID : VIEWER_GRID} border-b border-gray-200 bg-gray-50`}>
          {Array.from({ length: columnCount }).map((_, index) => (
            <div key={index} className="px-2.5 py-3"><div className="h-3 w-16 rounded bg-gray-200" /></div>
          ))}
        </div>
        <div className="min-h-0 flex-1 divide-y divide-gray-100 overflow-hidden">
          {Array.from({ length: 9 }).map((_, row) => (
            <div key={row} className={`grid ${isAdmin ? ADMIN_GRID : VIEWER_GRID} items-center`}>
              {Array.from({ length: columnCount }).map((_, cell) => (
                <div key={cell} className="px-2.5 py-3">
                  {cell === 4 ? (
                    <div className="flex h-10 items-center gap-2.5">
                      {[0, 1, 2].map((slot) => (
                        <div key={slot} className="flex flex-1 justify-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="h-4 w-11 rounded-md bg-gray-100" />
                            <div className="h-3 w-[74px] rounded bg-gray-100" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-4 rounded bg-gray-100" style={{ width: `${40 + ((row + cell) % 4) * 13}%` }} />
                  )}
                  {cell === 0 ? <div className="mt-1 h-3 w-20 rounded bg-gray-100" /> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
