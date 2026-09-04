"use client";

import type {
  ClassResponse,
  StaffAttendanceAccountStatus,
  StaffResponse,
} from "@/lib/types";
import { useClickableRowProps } from "@/lib/ui/click-guard";
import { formatCurrency } from "@/lib/utils/format";
import type { PreparedStaffRecord } from "@/lib/staff/presentation";
import {
  getClassScheduleSlots,
  getClassScheduleText,
  getClassTeacherIds,
  getSlotEffectiveAssistantIds,
  getSlotEffectiveTeacherIds,
  normalizeClassScheduleSlots,
} from "@/lib/classes/presentation";

export const STAFF_MANAGER_GRID =
  "w-full min-w-0 grid-cols-[minmax(140px,0.9fr)_minmax(170px,1fr)_minmax(240px,1.6fr)_minmax(200px,1.1fr)_minmax(120px,0.7fr)]";
export const STAFF_PRIVATE_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_minmax(340px,2fr)]";
export const STAFF_PUBLIC_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(200px,1fr)_minmax(360px,2.2fr)]";

type StaffTableProps = {
  canManage: boolean;
  canViewPrivate: boolean;
  classesById?: Map<string, ClassResponse>;
  onRowClick: (record: PreparedStaffRecord) => void;
  records: PreparedStaffRecord[];
};

export function StaffTable({
  canManage,
  canViewPrivate,
  classesById,
  onRowClick,
  records,
}: StaffTableProps) {
  const gridClass = canManage
    ? STAFF_MANAGER_GRID
    : canViewPrivate
      ? STAFF_PRIVATE_VIEWER_GRID
      : STAFF_PUBLIC_VIEWER_GRID;

  return (
    <div className="scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain xl:overflow-hidden">
      <div className="grid gap-3 xl:hidden">
        {records.map((record) => (
          <StaffCard
            key={record.staff.id}
            canManage={canManage}
            canViewPrivate={canViewPrivate}
            classesById={classesById}
            onRowClick={() => onRowClick(record)}
            record={record}
          />
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách nhân sự"
        className="hidden h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white xl:flex xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div role="row" className={`grid ${gridClass} table-heading-text items-center text-left text-gray-800`}>
            <ColumnHeader>Nhân sự</ColumnHeader>
            {canViewPrivate ? <ColumnHeader>Thông tin nhân sự</ColumnHeader> : null}
            <ColumnHeader>Lớp phụ trách</ColumnHeader>
            {canManage ? <ColumnHeader>Kết nối Email (Chấm công)</ColumnHeader> : null}
            {canManage ? <ColumnHeader>Thù lao</ColumnHeader> : null}
          </div>
        </div>

        <div
          role="rowgroup"
          className="scrollbar-hidden min-h-0 flex-1 touch-pan-y divide-y divide-gray-200 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {records.map((record) => {
            const { staff } = record;
            return (
              <StaffTableRow
                key={staff.id}
                canManage={canManage}
                canViewPrivate={canViewPrivate}
                classesById={classesById}
                gridClass={gridClass}
                onRowClick={() => onRowClick(record)}
                record={record}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StaffTableRow({
  canManage,
  canViewPrivate,
  classesById,
  gridClass,
  onRowClick,
  record,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
  classesById?: Map<string, ClassResponse>;
  gridClass: string;
  onRowClick: () => void;
  record: PreparedStaffRecord;
}) {
  const { staff } = record;
  const clickableProps = useClickableRowProps(canManage ? onRowClick : undefined);
  return (
    <div
      role="row"
      {...clickableProps}
      tabIndex={canManage ? 0 : undefined}
      onKeyDown={(event) => {
        if (canManage && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onRowClick();
        }
      }}
      className={`cv-auto grid ${gridClass} items-center transition-colors ${canManage ? "cursor-pointer hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30" : ""}`}
    >
      <DataCell>
        <p className="break-words font-semibold text-gray-950">{staff.full_name}</p>
        <p className="mt-0.5 select-none text-[13px] font-medium leading-4 text-gray-500">
          {record.summaryRoles}
        </p>
      </DataCell>
      {canViewPrivate ? (
        <DataCell className="text-gray-700">
          <ContactSummary record={record} />
        </DataCell>
      ) : null}
      <DataCell className="text-gray-700">
        <ClassAssignments record={record} classesById={classesById} />
      </DataCell>
      {canManage ? (
        <DataCell className="text-gray-700">
          <AttendanceEmailConnection staff={staff} />
        </DataCell>
      ) : null}
      {canManage ? (
        <DataCell className="text-gray-700">
          <RateCell currentRate={staff.current_rate} />
        </DataCell>
      ) : null}
    </div>
  );
}

function StaffCard({
  canManage,
  canViewPrivate,
  classesById,
  onRowClick,
  record,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
  classesById?: Map<string, ClassResponse>;
  onRowClick: () => void;
  record: PreparedStaffRecord;
}) {
  const { staff } = record;
  const clickableProps = useClickableRowProps(canManage ? onRowClick : undefined);
  return (
    <article
      {...clickableProps}
      tabIndex={canManage ? 0 : undefined}
      onKeyDown={(event) => {
        if (canManage && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onRowClick();
        }
      }}
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)] ${canManage ? "cursor-pointer transition hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-gray-950">{staff.full_name}</h2>
          <p className="mt-0.5 select-none text-[13px] font-medium text-gray-500">
            {record.summaryRoles}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-[15px] font-medium leading-5 sm:grid-cols-2">
        {canViewPrivate ? (
          <div className="min-w-0">
            <dt className="table-heading-text select-none text-gray-500">Thông tin nhân sự</dt>
            <dd className="mt-1 text-gray-700"><ContactSummary record={record} /></dd>
          </div>
        ) : null}
        {canManage ? (
          <div className="min-w-0">
            <dt className="table-heading-text select-none text-gray-500">
              Kết nối Email (Chấm công)
            </dt>
            <dd className="mt-1">
              <AttendanceEmailConnection staff={staff} />
            </dd>
          </div>
        ) : null}
        {canManage ? (
          <div className="min-w-0">
            <dt className="table-heading-text select-none text-gray-500">Thù lao</dt>
            <dd className="mt-1"><RateCell currentRate={staff.current_rate} /></dd>
          </div>
        ) : null}
        <div className="min-w-0 sm:col-span-2">
          <dt className="table-heading-text select-none text-gray-500">Lớp phụ trách</dt>
          <dd className="mt-1 text-gray-700"><ClassAssignments record={record} classesById={classesById} /></dd>
        </div>
      </dl>
    </article>
  );
}

export function formatStaffAssignedClassSchedule(
  class_: ClassResponse,
  staff: StaffResponse,
): string {
  const allSlots = normalizeClassScheduleSlots(getClassScheduleSlots(class_));
  if (allSlots.length === 0) {
    return getClassScheduleText(class_);
  }

  const staffSlots = allSlots.filter((slot) => {
    const teacherIds = getSlotEffectiveTeacherIds(slot, getClassTeacherIds(class_));
    const assistantIds = getSlotEffectiveAssistantIds(slot);
    return teacherIds.includes(staff.id) || assistantIds.includes(staff.id);
  });

  const targetSlots = staffSlots.length > 0 ? staffSlots : allSlots;
  return targetSlots
    .map((slot) => `${slot.day} (${slot.start}–${slot.end})`)
    .join(", ");
}

function ClassAssignments({
  record,
  classesById,
}: {
  record: PreparedStaffRecord;
  classesById?: Map<string, ClassResponse>;
}) {
  if (record.activeClasses.length === 0) return <EmptyValue />;

  return (
    <div className="space-y-1 py-0.5">
      {record.activeClasses.map((classItem) => {
        const fullClass = classesById?.get(classItem.id);
        const scheduleLabel = fullClass
          ? formatStaffAssignedClassSchedule(fullClass, record.staff)
          : null;

        return (
          <div key={classItem.id} className="text-[13px] leading-snug break-words">
            <span className="font-semibold text-gray-950">
              {classItem.name}
              {classItem.role ? (
                <span className="font-normal text-gray-500">
                  {" "}({classItem.role === "TEACHER" ? "GV" : "TG"})
                </span>
              ) : null}
            </span>
            {scheduleLabel ? (
              <span className="font-normal text-gray-600">: {scheduleLabel}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ContactSummary({ record }: { record: PreparedStaffRecord }) {
  const { staff } = record;
  if (!staff.zalo_name || !staff.phone) return <EmptyValue />;
  return (
    <div className="min-w-0 space-y-0.5 break-words">
      <p><span className="select-none text-gray-500">Zalo:</span> {staff.zalo_name}</p>
      <p><span className="select-none text-gray-500">SĐT:</span> {staff.phone}</p>
    </div>
  );
}

const ATTENDANCE_ACCOUNT_LABELS: Record<
  StaffAttendanceAccountStatus,
  { dotClass: string; label: string }
> = {
  connected: { dotClass: "bg-emerald-500", label: "Đã kết nối" },
  disabled: { dotClass: "bg-red-500", label: "Tài khoản bị vô hiệu hóa" },
  invited: { dotClass: "bg-amber-500", label: "Đã gửi lời mời" },
  expired: { dotClass: "bg-orange-500", label: "Lời mời hết hạn" },
  not_connected: { dotClass: "bg-gray-300", label: "Chưa kết nối" },
};

function AttendanceEmailConnection({ staff }: { staff: StaffResponse }) {
  const status = ATTENDANCE_ACCOUNT_LABELS[staff.attendance_account_status];
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-gray-800">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status.dotClass}`} />
        {status.label}
      </p>
      {staff.email ? (
        <p className="break-all text-[13px] font-normal leading-5 text-gray-600">{staff.email}</p>
      ) : (
        <p className="text-[13px] font-normal leading-5 text-gray-400">Chưa có email</p>
      )}
    </div>
  );
}

function RateCell({
  currentRate,
}: {
  currentRate: number | null;
}) {
  if (currentRate !== null) {
    return (
      <span className="text-[13px] font-semibold tabular-nums text-gray-800">
        {formatCurrency(currentRate)}
        <span className="ml-0.5 font-normal text-gray-500">/buổi</span>
      </span>
    );
  }
  return <span className="select-none text-gray-400">—</span>;
}

function ColumnHeader({ children }: { children: React.ReactNode }) {
  return (
    <div role="columnheader" className="select-none whitespace-nowrap px-2.5 py-3">
      {children}
    </div>
  );
}

function DataCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="cell" className={`min-w-0 px-2.5 py-3 text-[15px] font-medium leading-5 ${className}`}>
      {children}
    </div>
  );
}

function EmptyValue() {
  return <span aria-label="Chưa có thông tin" className="select-none font-normal text-gray-400">—</span>;
}
