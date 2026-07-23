"use client";

import { Pencil, RotateCcw, UserRoundX } from "lucide-react";
import { getStaffTypeLabel, type PreparedStaffRecord } from "@/lib/staff/presentation";

export const STAFF_MANAGER_GRID =
  "w-full min-w-0 grid-cols-[minmax(170px,1fr)_minmax(220px,1.25fr)_minmax(300px,1.7fr)_minmax(132px,.72fr)_78px]";
export const STAFF_PRIVATE_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(180px,1fr)_minmax(230px,1.25fr)_minmax(320px,1.8fr)_minmax(140px,.75fr)]";
export const STAFF_PUBLIC_VIEWER_GRID =
  "w-full min-w-0 grid-cols-[minmax(190px,1fr)_minmax(320px,1.8fr)_minmax(150px,.8fr)]";

type StaffTableProps = {
  canManage: boolean;
  canViewPrivate: boolean;
  onEdit: (record: PreparedStaffRecord) => void;
  onToggleStatus: (record: PreparedStaffRecord) => void;
  records: PreparedStaffRecord[];
};

export function StaffTable({ canManage, canViewPrivate, onEdit, onToggleStatus, records }: StaffTableProps) {
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
            onEdit={() => onEdit(record)}
            onToggleStatus={() => onToggleStatus(record)}
            record={record}
          />
        ))}
      </div>

      <div
        role="table"
        aria-label="Danh sách nhân sự"
        className="hidden h-full min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white xl:flex xl:flex-col"
      >
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div role="row" className={`grid ${gridClass} table-heading-text items-center text-left text-gray-700`}>
            <ColumnHeader>Nhân sự</ColumnHeader>
            {canViewPrivate ? <ColumnHeader>Thông tin nhân sự</ColumnHeader> : null}
            <ColumnHeader>Lớp phụ trách</ColumnHeader>
            <ColumnHeader>Trạng thái</ColumnHeader>
            {canManage ? <ColumnHeader compact>Thao tác</ColumnHeader> : null}
          </div>
        </div>

        <div
          role="rowgroup"
          className="scrollbar-hidden min-h-0 flex-1 touch-pan-y divide-y divide-gray-100 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {records.map((record) => {
            const { staff } = record;
            return (
              <div
                key={staff.id}
                role="row"
                className={`cv-auto grid ${gridClass} items-center transition-colors hover:bg-gray-50/80`}
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
                {canManage ? (
                  <DataCell compact className="flex self-stretch items-center justify-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <IconButton label={`Chỉnh sửa ${staff.full_name}`} onClick={() => onEdit(record)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      {staff.staff_type === "TEACHER" ? (
                        <IconButton
                          label={`${staff.is_active ? "Ngừng hoạt động" : "Kích hoạt lại"} ${staff.full_name}`}
                          tone={staff.is_active ? "danger" : "success"}
                          onClick={() => onToggleStatus(record)}
                        >
                          {staff.is_active ? (
                            <UserRoundX className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          )}
                        </IconButton>
                      ) : null}
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

function StaffCard({
  canManage,
  canViewPrivate,
  onEdit,
  onToggleStatus,
  record,
}: {
  canManage: boolean;
  canViewPrivate: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  record: PreparedStaffRecord;
}) {
  const { staff } = record;
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-gray-950">{staff.full_name}</h2>
          <p className="mt-0.5 select-none text-[13px] font-medium text-gray-500">
            {getStaffTypeLabel(staff.staff_type)}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-1.5">
            <IconButton label={`Chỉnh sửa ${staff.full_name}`} onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            {staff.staff_type === "TEACHER" ? (
              <IconButton
                label={`${staff.is_active ? "Ngừng hoạt động" : "Kích hoạt lại"} ${staff.full_name}`}
                tone={staff.is_active ? "danger" : "success"}
                onClick={onToggleStatus}
              >
                {staff.is_active ? (
                  <UserRoundX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                )}
              </IconButton>
            ) : null}
          </div>
        ) : null}
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
  return (
    <span className={`inline-flex select-none items-center gap-1.5 whitespace-nowrap ${isActive ? "text-emerald-700" : "text-gray-500"}`}>
      <span className={`h-2 w-2 rounded-full ${isActive ? "bg-emerald-500" : "bg-gray-300"}`} aria-hidden="true" />
      {isActive ? "Đang hoạt động" : "Đã ngừng"}
    </span>
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

function IconButton({
  children,
  label,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass = tone === "danger"
    ? "border-red-200 text-red-700 hover:bg-red-50 focus-visible:ring-red-200"
    : tone === "success"
      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-200"
      : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus-visible:ring-gray-200";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border bg-white transition focus-visible:outline-none focus-visible:ring-2 ${toneClass}`}
    >
      {children}
    </button>
  );
}
