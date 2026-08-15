"use client";

import { ClassScheduleList } from "@/components/classes/class-schedule-list";
import { useClickableRowProps } from "@/lib/ui/click-guard";
import type { ClassResponse, ClassScope } from "@/lib/types";
import {
  getClassAssistantNames,
  getClassCategoryLabel,
  getClassGradeYearLabel,
  getClassGroupInfoForRecord,
  getClassInfoLine,
  getClassScheduleSlots,
  getClassScheduleSummary,
  getClassTeacherNames,
  getClassTotalDurationLabel,
  getCourseDurationLabel,
} from "@/lib/classes/presentation";
import { formatCurrency, formatDate } from "@/lib/utils/format";

type ClassesTableProps = {
  classes: ClassResponse[];
  onRowClick: (class_: ClassResponse) => void;
  scope: ClassScope;
  selectedDay: string;
};

type ClassColumn = {
  key: string;
  label: string;
};

const OPERATIONAL_COLUMNS: ClassColumn[] = [
  { key: "info", label: "Thông tin lớp" },
  { key: "time", label: "Thời gian" },
  { key: "fee", label: "Học phí" },
  { key: "staff", label: "Nhân sự" },
  { key: "schedule", label: "Lịch học" },
];

const HISTORICAL_COLUMNS: ClassColumn[] = [
  { key: "info", label: "Thông tin lớp" },
  { key: "time", label: "Thời gian" },
  { key: "staff", label: "Nhân sự" },
  { key: "headcount", label: "Sĩ số lịch sử" },
  { key: "end", label: "Kết thúc" },
];

/**
 * Single source for each class list grid, shared by header, rows and skeleton.
 * The dashboard always renders exactly one row of five columns.
 * Scopes with sparse content (sắp mở, đã kết thúc, đã huỷ) share equal columns
 * so the table reads balanced instead of leaving empty bands.
 */
const OPERATIONAL_GRID_CLASS =
  "grid grid-cols-[minmax(0,21fr)_minmax(0,16fr)_minmax(0,17fr)_minmax(0,18fr)_minmax(0,28fr)]";

const SPARSE_GRID_CLASS = "grid grid-cols-[repeat(5,minmax(0,1fr))]";

const TABLE_FRAME_CLASS =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm";

const TABLE_HEADER_CLASS = "shrink-0 border-b border-gray-200 bg-gray-100";

const TABLE_BODY_CLASS =
  "scrollbar-hidden min-h-0 flex-1 divide-y divide-gray-200 overflow-y-auto overscroll-contain";

export function ClassesTable({
  classes,
  onRowClick,
  scope,
  selectedDay,
}: ClassesTableProps) {
  const isOperationalScope = scope === "operational" || scope === "scheduled";
  if (!isOperationalScope) {
    return (
      <HistoricalClassesTable
        classes={classes}
        onRowClick={onRowClick}
        scope={scope}
      />
    );
  }

  return (
    <div role="table" aria-label="Danh sách lớp học" className={TABLE_FRAME_CLASS}>
      <div role="rowgroup" className={TABLE_HEADER_CLASS}>
        <div role="row" className={`${OPERATIONAL_GRID_CLASS} table-heading-text select-none text-gray-700`}>
          {OPERATIONAL_COLUMNS.map((column) => (
            <ColumnHeader key={column.key}>{column.label}</ColumnHeader>
          ))}
        </div>
      </div>
      <div role="rowgroup" className={TABLE_BODY_CLASS}>
        {classes.map((class_) => {
          const group = getClassGroupInfoForRecord(class_);
          const teacherNames = getClassTeacherNames(class_);
          const assistantNames = getClassAssistantNames(class_);
          const classInfoLine = getClassInfoLine(class_);
          const totalDurationLabel = getClassTotalDurationLabel(class_);
          return (
            <ClickableRow key={class_.id} gridClass={OPERATIONAL_GRID_CLASS} onClick={() => onRowClick(class_)}>
              <DataCell col="info" className="pl-4 pr-3 font-semibold text-gray-950">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color.border }}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span className="block min-w-0 break-words text-[15px] font-semibold leading-5 text-gray-950">
                        {class_.primary_label}
                      </span>
                      <span className="inline-flex shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[12px] font-semibold leading-4 text-gray-600">
                        {getClassCategoryLabel(class_)}
                      </span>
                    </div>
                    {classInfoLine ? (
                      <span className="mt-1 block break-words text-[13px] font-medium leading-[18px] text-gray-600">
                        {classInfoLine}
                      </span>
                    ) : null}
                  </div>
                </div>
              </DataCell>
              <DataCell col="time" className="px-3 text-gray-700">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <ClassStatus status={class_.effective_status} />
                  {totalDurationLabel ? (
                    <span className="whitespace-nowrap text-[13px] font-medium leading-[18px] text-gray-600">
                      · {totalDurationLabel}
                    </span>
                  ) : null}
                </div>
                {class_.unresolved_makeup_count ? (
                  <div className="mt-1">
                    <MakeupPendingBadge count={class_.unresolved_makeup_count} />
                  </div>
                ) : null}
                <span className="mt-1 block text-[13px] font-medium leading-[18px] tabular-nums text-gray-600">
                  {formatDate(class_.start_date)}–{formatDate(class_.end_date)}
                </span>
              </DataCell>
              <DataCell col="fee" className="px-3 text-gray-700">
                <span className="metric-money block text-[15px] font-semibold leading-5 text-gray-950">
                  {formatCurrency(class_.base_fee)}
                </span>
                <FeeMetaLine class_={class_} />
              </DataCell>
              <DataCell col="staff" className="px-3 text-gray-700">
                <StaffValue teachers={teacherNames} assistants={assistantNames} />
              </DataCell>
              <DataCell col="schedule" className="self-stretch pl-3 pr-4 text-gray-700">
                <div className="flex h-full min-h-0 flex-col justify-center">
                  <ScheduleValue class_={class_} selectedDay={selectedDay} />
                </div>
              </DataCell>
            </ClickableRow>
          );
        })}
      </div>
    </div>
  );
}

function HistoricalClassesTable({
  classes,
  onRowClick,
  scope,
}: Pick<ClassesTableProps, "classes" | "onRowClick" | "scope">) {
  const isCancelledScope = scope === "cancelled";
  const lastColumnLabel = isCancelledScope ? "Ngày huỷ" : "Kết thúc";
  const historicalColumns: ClassColumn[] = [
    ...HISTORICAL_COLUMNS.slice(0, 4),
    { key: "end", label: lastColumnLabel },
  ];

  return (
    <div role="table" aria-label="Danh sách lớp lịch sử" className={TABLE_FRAME_CLASS}>
      <div role="rowgroup" className={TABLE_HEADER_CLASS}>
        <div role="row" className={`${SPARSE_GRID_CLASS} table-heading-text select-none text-gray-700`}>
          {historicalColumns.map((column) => (
            <ColumnHeader
              key={column.key}
              align={column.key === "headcount" || column.key === "end" ? "center" : "left"}
            >
              {column.label}
            </ColumnHeader>
          ))}
        </div>
      </div>
      <div role="rowgroup" className={TABLE_BODY_CLASS}>
        {classes.map((class_) => {
          const group = getClassGroupInfoForRecord(class_);
          const teacherNames = getClassTeacherNames(class_);
          const assistantNames = getClassAssistantNames(class_);
          const totalDurationLabel = getClassTotalDurationLabel(class_);
          const gradeYearLabel = getClassGradeYearLabel(class_);
          const endDateLabel = isCancelledScope
            ? class_.cancelled_at ?? class_.end_date
            : class_.end_date;
          return (
            <ClickableRow key={class_.id} gridClass={SPARSE_GRID_CLASS} onClick={() => onRowClick(class_)}>
              <DataCell col="info" className="pl-4 pr-3 font-semibold text-gray-950">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color.border }}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span className="block min-w-0 break-words text-[15px] font-semibold leading-5 text-gray-950">
                        {class_.primary_label}
                      </span>
                      <span className="inline-flex shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[12px] font-semibold leading-4 text-gray-600">
                        {getClassCategoryLabel(class_)}
                      </span>
                    </div>
                    {gradeYearLabel ? (
                      <span className="mt-1 block break-words text-[13px] font-medium leading-[18px] text-gray-600">
                        {gradeYearLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </DataCell>
              <DataCell col="time" className="px-3 text-gray-700">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <ClassStatus status={class_.effective_status} />
                  {totalDurationLabel ? (
                    <span className="whitespace-nowrap text-[13px] font-medium leading-[18px] text-gray-600">
                      · {totalDurationLabel}
                    </span>
                  ) : null}
                </div>
                <span className="mt-1 block text-[13px] font-medium leading-[18px] tabular-nums text-gray-600">
                  Bắt đầu: {formatDate(class_.start_date)}
                </span>
              </DataCell>
              <DataCell col="staff" className="px-3 text-gray-700">
                <StaffValue teachers={teacherNames} assistants={assistantNames} />
              </DataCell>
              <DataCell col="headcount" className="self-stretch px-3 text-gray-700">
                <div className="flex h-full min-h-0 items-center justify-center text-center">
                  <span className="text-[13px] font-medium leading-[18px] tabular-nums">
                    {class_.student_count} học viên
                  </span>
                </div>
              </DataCell>
              <DataCell col="end" className="self-stretch pl-3 pr-4 text-gray-600">
                <div className="flex h-full min-h-0 items-center justify-center text-center">
                  <span className="block whitespace-nowrap text-[13px] font-medium leading-[18px] tabular-nums">
                    {formatDate(endDateLabel)}
                  </span>
                </div>
              </DataCell>
            </ClickableRow>
          );
        })}
      </div>
    </div>
  );
}

function ClickableRow({
  children,
  gridClass,
  onClick,
}: {
  children: React.ReactNode;
  gridClass: string;
  onClick: () => void;
}) {
  const rowProps = useClickableRowProps(onClick);
  return (
    <div
      role="row"
      tabIndex={0}
      {...rowProps}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`${gridClass} cursor-pointer items-start transition-colors hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30`}
    >
      {children}
    </div>
  );
}

function ScheduleValue({ class_, selectedDay }: { class_: ClassResponse; selectedDay: string }) {
  const allSlots = getClassScheduleSlots(class_);
  const matchingSlots = selectedDay ? allSlots.filter((slot) => slot.day === selectedDay) : allSlots;
  const fullText = getClassScheduleSummary(class_, { day: selectedDay || undefined });

  if (matchingSlots.length === 0) {
    return fullText === "—" ? (
      <EmptyValue />
    ) : (
      <span className="block break-words text-[15px] font-medium leading-5 text-gray-700">
        {fullText}
      </span>
    );
  }

  return <ClassScheduleList activeDay={selectedDay || undefined} slots={allSlots} />;
}

function FeeMetaLine({ class_ }: { class_: ClassResponse }) {
  const clusters: Array<{ key: string; text: string; tone?: "amber" }> = [];
  if (class_.type === "MONTHLY") {
    clusters.push({ key: "mode", text: "Theo tháng" });
  } else {
    clusters.push({ key: "mode", text: "Theo gói" });
    clusters.push({
      key: "weeks",
      text: `· ${getCourseDurationLabel(
        class_.billing_cycle_weeks,
        class_.billing_cycle_months,
      )}`,
    });
  }
  if (class_.next_fee_due_state === "OVERDUE" && class_.next_fee_due_date) {
    clusters.push({
      key: "due",
      tone: "amber",
      text: `· Quá hạn ${formatDate(class_.next_fee_due_date)}`,
    });
  } else if (class_.next_fee_due_state === "UPCOMING" && class_.next_fee_due_date) {
    clusters.push({
      key: "due",
      text: `· Thu ${formatDate(class_.next_fee_due_date)}`,
    });
  }

  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 text-[13px] font-medium leading-[18px] tabular-nums text-gray-600">
      {clusters.map((cluster) => (
        <span
          key={cluster.key}
          className={`whitespace-nowrap ${cluster.tone === "amber" ? "font-semibold text-amber-700" : ""}`}
        >
          {cluster.text}
        </span>
      ))}
    </span>
  );
}

function StaffValue({
  teachers,
  assistants,
}: {
  teachers: string[];
  assistants: string[];
}) {
  if (teachers.length === 0 && assistants.length === 0) {
    return <EmptyValue />;
  }
  return (
    <div className="min-w-0 space-y-0.5">
      {teachers.length > 0 ? (
        <span className="block break-words text-sm font-medium leading-5 text-gray-800">
          <span className="text-[13px] font-medium leading-[18px] text-gray-500">Giáo viên: </span>
          {teachers.join(", ")}
        </span>
      ) : null}
      {assistants.length > 0 ? (
        <span className="block break-words text-sm font-medium leading-5 text-gray-800">
          <span className="text-[13px] font-medium leading-[18px] text-gray-500">Trợ giảng: </span>
          {assistants.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

function ColumnHeader({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <div
      role="columnheader"
      className={`select-none whitespace-nowrap px-3 py-3 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function DataCell({
  children,
  className = "",
  align = "left",
  col,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  col?: string;
}) {
  return (
    <div
      role="cell"
      data-col={col}
      className={`min-w-0 px-3 py-2.5 text-[15px] font-medium leading-5 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function EmptyValue() {
  return (
    <span aria-label="Chưa có thông tin" className="select-none font-normal text-gray-400">
      —
    </span>
  );
}

function ClassStatus({ status }: { status: ClassResponse["effective_status"] }) {
  const value = {
    SCHEDULED: { label: "Sắp mở", className: "bg-sky-50 text-sky-700" },
    ACTIVE: { label: "Đang học", className: "bg-emerald-50 text-emerald-700" },
    LEGACY: { label: "Dữ liệu cũ", className: "bg-gray-100 text-gray-600" },
    COMPLETED: { label: "Đã kết thúc", className: "bg-gray-100 text-gray-600" },
    CANCELLED: { label: "Đã hủy", className: "bg-red-50 text-red-700" },
  }[status];
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[12px] font-semibold leading-4 ${value.className}`}
    >
      {value.label}
    </span>
  );
}

export function MakeupPendingBadge({ count }: { count: number }) {
  if (!count) {
    return null;
  }
  return (
    <span
      title={`${count} buổi chờ bù`}
      className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[12px] font-semibold leading-4 text-amber-700 ring-1 ring-inset ring-amber-200"
    >
      {count} buổi chờ bù
    </span>
  );
}

export function ClassesSkeleton() {
  return (
    <div aria-hidden="true" className={`${TABLE_FRAME_CLASS} animate-pulse`}>
      <div className={TABLE_HEADER_CLASS}>
        <div className={`${OPERATIONAL_GRID_CLASS} px-3 py-3`}>
          {OPERATIONAL_COLUMNS.map((column) => (
            <div key={column.key}>
              <div className="h-4 w-16 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
      <div className={TABLE_BODY_CLASS}>
        {Array.from({ length: 8 }).map((_, row) => (
          <div key={row} className={`${OPERATIONAL_GRID_CLASS} items-start`}>
            <div className="min-w-0 pl-4 pr-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-200" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-2/3 rounded bg-gray-200" />
                  <div className="mt-1 h-[18px] w-full rounded bg-gray-100" />
                </div>
              </div>
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="h-5 w-20 rounded bg-gray-200" />
              <div className="mt-1 h-[18px] w-full rounded bg-gray-100" />
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="h-5 w-3/4 rounded bg-gray-200" />
              <div className="mt-1 h-[18px] w-2/3 rounded bg-gray-100" />
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="h-5 w-3/4 rounded bg-gray-100" />
              <div className="mt-0.5 h-5 w-1/2 rounded bg-gray-100" />
            </div>
            <div className="min-w-0 self-stretch pl-3 pr-4 py-2.5">
              <div className="flex h-full min-h-0 flex-col justify-center">
                <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2">
                  {Array.from({ length: 4 }).map((_, track) => (
                    <div key={track} className="h-9 min-w-0 rounded bg-gray-100" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HistoricalClassesSkeleton() {
  return (
    <div aria-hidden="true" className={`${TABLE_FRAME_CLASS} animate-pulse`}>
      <div className={TABLE_HEADER_CLASS}>
        <div className={`${SPARSE_GRID_CLASS} px-3 py-3`}>
          {HISTORICAL_COLUMNS.map((column) => (
            <div key={column.key} className={column.key === "headcount" || column.key === "end" ? "text-center" : undefined}>
              <div className="h-4 w-16 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
      <div className={TABLE_BODY_CLASS}>
        {Array.from({ length: 8 }).map((_, row) => (
          <div key={row} className={`${SPARSE_GRID_CLASS} items-start`}>
            <div className="min-w-0 pl-4 pr-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-200" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-2/3 rounded bg-gray-200" />
                  <div className="mt-1 h-[18px] w-full rounded bg-gray-100" />
                </div>
              </div>
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="h-5 w-20 rounded bg-gray-200" />
              <div className="mt-1 h-[18px] w-full rounded bg-gray-100" />
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="h-5 w-3/4 rounded bg-gray-100" />
              <div className="mt-0.5 h-5 w-1/2 rounded bg-gray-100" />
            </div>
            <div className="min-w-0 self-stretch px-3 py-2.5">
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="h-5 w-20 rounded bg-gray-100" />
              </div>
            </div>
            <div className="min-w-0 self-stretch pl-3 pr-4 py-2.5">
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="h-5 w-16 rounded bg-gray-100" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
