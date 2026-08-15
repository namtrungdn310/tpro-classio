"use client";

import { useClickableRowProps } from "@/lib/ui/click-guard";
import { getStaffTypeLabel, type PreparedStaffRecord } from "@/lib/staff/presentation";

export const STAFF_MANAGER_GRID =
  "w-full min-w-0 grid-cols-[minmax(170px,1fr)_minmax(220px,1.25fr)_minmax(300px,1.7fr)_minmax(132px,.72fr)]";
export const STAFF_PRIVATE_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(180px,1fr)_minmax(230px,1.25fr)_minmax(320px,1.8fr)_minmax(140px,.75fr)]";
export const STAFF_PUBLIC_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(190px,1fr)_minmax(320px,1.8fr)_minmax(150px,.8fr)]";

type StaffTableProps = {
  canManage: boolean;
  canViewPrivate: boolean;
  onRowClick: (record: PreparedStaffRecord) => void;
  records: PreparedStaffRecord[];
};

export function StaffTable({ canManage, canViewPrivate, onRowClick, records }: StaffTableProps) {
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
            <ColumnHeader>Trạng thái</ColumnHeader>
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
  gridClass,
  onRowClick,
  record,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
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
          {getStaffTypeLabel(staff.staff_type)}
        </p>
      </DataCell>
      {canViewPrivate ? (
        <DataCell className="text-gray-700">
          <ContactSummary record={record} />
        </DataCell>
      ) : null}
      <DataCell className="text-gray-700">
        <ClassAssignments record={record} />
      </DataCell>
      <DataCell>
        <ActivityStatus isActive={staff.is_active} />
      </DataCell>
    </div>
  );
}

function StaffCard({
  canManage,
  canViewPrivate,
  onRowClick,
  record,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
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
            {getStaffTypeLabel(staff.staff_type)}
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
        <div className="min-w-0">
          <dt className="table-heading-text select-none text-gray-500">Trạng thái</dt>
          <dd className="mt-1"><ActivityStatus isActive={staff.is_active} /></dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="table-heading-text select-none text-gray-500">Lớp phụ trách</dt>
          <dd className="mt-1 text-gray-700"><ClassAssignments record={record} /></dd>
        </div>
      </dl>
    </article>
  );
}

function ClassAssignments({ record }: { record: PreparedStaffRecord }) {
  if (record.activeClasses.length === 0) return <EmptyValue />;
  return (
    <span className="block break-words">
      {record.activeClasses.map((class_) => class_.name).join(", ")}
    </span>
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

function ActivityStatus({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return (
      <span className="inline-flex select-none items-center whitespace-nowrap rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
        Đang hoạt động
      </span>
    );
  }

  return (
    <span className="inline-flex select-none items-center whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
      Đã ngừng
    </span>
  );
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
