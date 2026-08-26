"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RiCloseCircleLine as CloseCircle,
  RiDeleteBinLine as Trash2,
  RiArchiveLine as Archive,
  RiHistoryLine as History,
  RiRefreshLine as Restore,
  RiPencilLine as Pencil,
} from "react-icons/ri";
import { useQuery } from "@tanstack/react-query";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import { getStudentEnrollments } from "@/lib/api/students";
import { formatDate, formatCurrency } from "@/lib/utils/format";
import { formatStudentCode } from "@/lib/students/student-code";
import { studentQueryKeys } from "@/lib/students/query-keys";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type { ClassResponse, StudentResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export type StudentWorkspaceMode = "edit" | "history" | "remove" | "archive" | "restore";

type StudentWorkspaceDialogProps = {
  student: StudentResponse | null;
  selectedClass: ClassResponse | null;
  initialMode?: StudentWorkspaceMode;
  isSaving: boolean;
  isDeleting: boolean;
  isLifecyclePending?: boolean;
  onClose: () => void;
  onRemoveFromClass: () => void;
  onArchive?: (reason: string) => void;
  onRestore?: (reason: string) => void;
  renderEditPanel: (props: {
    embedded: boolean;
    onDirtyChange: (dirty: boolean) => void;
    onNestedOverlayChange: (open: boolean) => void;
    onClose: () => void;
  }) => React.ReactNode;
};

const MODE_HEADERS: Record<StudentWorkspaceMode, string> = {
  edit: "Chỉnh sửa học viên",
  history: "Lịch sử lớp học",
  remove: "Rời lớp",
  archive: "Ngừng học",
  restore: "Tiếp nhận lại",
};

export function StudentWorkspaceDialog({
  student,
  selectedClass,
  initialMode = "edit",
  isSaving,
  isDeleting,
  isLifecyclePending = false,
  onClose,
  onRemoveFromClass,
  onArchive,
  onRestore,
  renderEditPanel,
}: StudentWorkspaceDialogProps) {
  const [mode, setMode] = useState<StudentWorkspaceMode>(initialMode);
  const [displayMode, setDisplayMode] = useState<StudentWorkspaceMode>(initialMode);
  const [leaving, setLeaving] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [nestedOverlayOpen, setNestedOverlayOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const modeTimerRef = useRef<number | null>(null);
  const pendingModeRef = useRef<StudentWorkspaceMode | null>(null);
  const reducedMotionRef = useRef(false);
  const enrollmentsQuery = useQuery({
    queryKey: studentQueryKeys.enrollments(student?.id ?? ""),
    queryFn: ({ signal }) => getStudentEnrollments(student!.id, signal),
    enabled: Boolean(student),
    staleTime: 60_000,
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (modeTimerRef.current !== null) {
        window.clearTimeout(modeTimerRef.current);
      }
      pendingModeRef.current = null;
    };
  }, []);

  const requestClose = useCallback(() => {
    if (dirty && !isSaving && !isDeleting && !isLifecyclePending) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, isSaving, isDeleting, isLifecyclePending, onClose]);

  const { backdropPointerDownRef, dialogRef, requestClose: requestShellClose } =
    useModalDialog({
      isBusy: isSaving || isDeleting || isLifecyclePending,
      onClose: requestClose,
      suspended: nestedOverlayOpen || confirmDiscardOpen,
    });

  function changeMode(next: StudentWorkspaceMode) {
    if (!student) {
      return;
    }
    if (next === mode) {
      if (modeTimerRef.current !== null) {
        window.clearTimeout(modeTimerRef.current);
        modeTimerRef.current = null;
        pendingModeRef.current = null;
        setLeaving(false);
      }
      return;
    }
    if (next === pendingModeRef.current) {
      return;
    }
    if (modeTimerRef.current !== null) {
      window.clearTimeout(modeTimerRef.current);
      modeTimerRef.current = null;
    }
    pendingModeRef.current = next;
    if (reducedMotionRef.current) {
      setMode(next);
      setDisplayMode(next);
      setLeaving(false);
      setAnimateIn(false);
      pendingModeRef.current = null;
      return;
    }
    setLeaving(true);
    modeTimerRef.current = window.setTimeout(() => {
      setMode(next);
      setDisplayMode(next);
      setLeaving(false);
      setAnimateIn(true);
      modeTimerRef.current = null;
      pendingModeRef.current = null;
    }, 130);
  }

  useEffect(() => {
    if (!panelRef.current) {
      return;
    }
    const panel = panelRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (displayMode === "edit") {
        const editPanel = panel.querySelector<HTMLElement>('[data-workspace-mode="edit"]');
        const firstField = editPanel?.querySelector<HTMLElement>("[data-dialog-autofocus]");
        (firstField ?? panel).focus({ preventScroll: true });
        return;
      }
      const activePanel = panel.querySelector<HTMLElement>(`[data-workspace-mode="${displayMode}"]`);
      const heading = activePanel?.querySelector<HTMLElement>("[data-workspace-heading]");
      (heading ?? panel).focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayMode]);

  if (!student) {
    return null;
  }

  const headerSubtitle = `${student.full_name}${student.student_code ? ` · Mã: ${formatStudentCode(student.student_code)}` : ""}${selectedClass ? ` · ${selectedClass.name}` : ""}`;

  const rail = (
    <StudentWorkspaceRail
      canRemove={Boolean(selectedClass)}
      isArchived={student.status === "archived"}
      mode={mode}
      dirty={dirty}
      onSelect={changeMode}
    />
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      onPointerDown={(event) => {
        backdropPointerDownRef.current =
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.dataset.workspaceDismissSurface === "true");
      }}
      onPointerUp={(event) => {
        const endedOutside =
          event.target === event.currentTarget ||
          (event.target instanceof HTMLElement &&
            event.target.dataset.workspaceDismissSurface === "true");
        if (backdropPointerDownRef.current && endedOutside) {
          requestShellClose();
        }
        backdropPointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        backdropPointerDownRef.current = false;
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-workspace-title"
        aria-busy={isSaving || isDeleting || isLifecyclePending || undefined}
        tabIndex={-1}
        inert={nestedOverlayOpen || confirmDiscardOpen ? true : undefined}
        data-workspace-dismiss-surface="true"
        className="relative z-10 flex h-full min-h-0 w-full items-stretch justify-center sm:items-center sm:p-4"
      >
        <div className="relative h-full min-h-0 w-full sm:h-[min(680px,calc(100dvh-2rem))] sm:max-w-[640px]">
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none sm:rounded-xl sm:border sm:border-gray-200">
            <FormDialogHeader
              title={MODE_HEADERS[displayMode]}
              subtitle={headerSubtitle}
              titleId="student-workspace-title"
              onClose={requestShellClose}
              closeDisabled={isSaving || isDeleting || isLifecyclePending}
            />
            <MobileStudentRail
              canRemove={Boolean(selectedClass)}
              isArchived={student.status === "archived"}
              mode={mode}
              dirty={dirty}
              onSelect={changeMode}
            />
            <div
              id="student-workspace-panel"
              role="tabpanel"
              aria-label={MODE_HEADERS[displayMode]}
              ref={panelRef}
              className={cn(
                "relative min-h-0 flex-1",
                leaving ? "workspace-panel-out" : animateIn ? "workspace-panel-in" : "",
              )}
            >
              <div
                data-workspace-mode="edit"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "edit"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "edit"}
                inert={displayMode !== "edit" ? true : undefined}
              >
                {renderEditPanel({
                  embedded: true,
                  onDirtyChange: setDirty,
                  onNestedOverlayChange: setNestedOverlayOpen,
                  onClose: requestShellClose,
                })}
              </div>

              <div
                data-workspace-mode="history"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "history"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "history"}
                inert={displayMode !== "history" ? true : undefined}
              >
                <StudentEnrollmentHistoryPanel
                  enrollments={enrollmentsQuery.data ?? []}
                  isLoading={enrollmentsQuery.isLoading}
                  error={enrollmentsQuery.error}
                  onRetry={() => void enrollmentsQuery.refetch()}
                />
              </div>

              <div
                data-workspace-mode="remove"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "remove"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "remove"}
                inert={displayMode !== "remove" ? true : undefined}
              >
                {selectedClass ? <RemoveFromClassPanel
                  student={student}
                  className={selectedClass?.name ?? "lớp đang chọn"}
                  dirty={dirty}
                  isDeleting={isDeleting}
                  onClose={requestShellClose}
                  onConfirm={onRemoveFromClass}
                /> : null}
              </div>

              <div
                data-workspace-mode={student.status === "archived" ? "restore" : "archive"}
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === (student.status === "archived" ? "restore" : "archive")
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== (student.status === "archived" ? "restore" : "archive")}
                inert={displayMode !== (student.status === "archived" ? "restore" : "archive") ? true : undefined}
              >
                <StudentLifecyclePanel
                  student={student}
                  restoring={student.status === "archived"}
                  isPending={isLifecyclePending}
                  onClose={requestShellClose}
                  onConfirm={(reason) => student.status === "archived" ? onRestore?.(reason) : onArchive?.(reason)}
                />
              </div>
            </div>
          </div>
          {!nestedOverlayOpen && !confirmDiscardOpen ? (
            <div className="workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-[900px]:block">
              {rail}
            </div>
          ) : null}
        </div>
      </div>

      {confirmDiscardOpen ? (
        <ConfirmationDialog
          open
          title="Thay đổi chưa được lưu"
          description="Bạn có thay đổi chưa được lưu trong biểu mẫu học viên. Rời khỏi sẽ bỏ qua các thay đổi này."
          confirmLabel="Rời khỏi"
          cancelLabel="Ở lại"
          isPending={isSaving}
          onCancel={() => setConfirmDiscardOpen(false)}
          onConfirm={() => {
            setConfirmDiscardOpen(false);
            onClose();
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function StudentWorkspaceRail({
  canRemove,
  isArchived,
  mode,
  dirty,
  onSelect,
}: {
  canRemove: boolean;
  isArchived: boolean;
  mode: StudentWorkspaceMode;
  dirty: boolean;
  onSelect: (mode: StudentWorkspaceMode) => void;
}) {
  const items: Array<{
    mode: StudentWorkspaceMode;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    ...(!isArchived ? [{
      mode: "edit",
      label: "Sửa học viên",
      icon: <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />,
    } as const] : []),
    {
      mode: "history",
      label: "Lịch sử lớp học",
      icon: <History className="h-[18px] w-[18px]" aria-hidden="true" />,
    },
    ...(canRemove ? [{
      mode: "remove",
      label: "Rời lớp",
      icon: <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />,
      danger: true,
    } as const] : []),
    {
      mode: isArchived ? "restore" : "archive",
      label: isArchived ? "Tiếp nhận lại" : "Ngừng học",
      icon: isArchived
        ? <Restore className="h-[18px] w-[18px]" aria-hidden="true" />
        : <Archive className="h-[18px] w-[18px]" aria-hidden="true" />,
      danger: !isArchived,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem học viên"
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          return;
        }
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        );
        const currentIndex = buttons.findIndex((button) => button === document.activeElement);
        if (currentIndex === -1) {
          return;
        }
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }}
      className="flex w-[188px] shrink-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/15"
    >
      {items.map((item) => (
        <StudentRailTabButton
          key={item.mode}
          label={item.label}
          icon={item.icon}
          danger={item.danger}
          active={mode === item.mode}
          dirty={item.mode === "edit" && dirty}
          onSelect={() => onSelect(item.mode)}
        />
      ))}
    </div>
  );
}

function MobileStudentRail({
  canRemove,
  isArchived,
  mode,
  dirty,
  onSelect,
}: {
  canRemove: boolean;
  isArchived: boolean;
  mode: StudentWorkspaceMode;
  dirty: boolean;
  onSelect: (mode: StudentWorkspaceMode) => void;
}) {
  const items: Array<{
    mode: StudentWorkspaceMode;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    ...(!isArchived ? [{
      mode: "edit",
      label: "Sửa học viên",
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
    } as const] : []),
    {
      mode: "history",
      label: "Lịch sử lớp",
      icon: <History className="h-4 w-4" aria-hidden="true" />,
    },
    ...(canRemove ? [{
      mode: "remove",
      label: "Rời lớp",
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      danger: true,
    } as const] : []),
    {
      mode: isArchived ? "restore" : "archive",
      label: isArchived ? "Tiếp nhận lại" : "Ngừng học",
      icon: isArchived
        ? <Restore className="h-4 w-4" aria-hidden="true" />
        : <Archive className="h-4 w-4" aria-hidden="true" />,
      danger: !isArchived,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem học viên"
      className="scrollbar-hidden flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-gray-100/60 px-3 py-1.5 min-[900px]:hidden"
    >
      {items.map((item) => (
        <MobileStudentRailTabButton
          key={item.mode}
          label={item.label}
          icon={item.icon}
          danger={item.danger}
          active={mode === item.mode}
          dirty={item.mode === "edit" && dirty}
          onSelect={() => onSelect(item.mode)}
        />
      ))}
    </div>
  );
}

function StudentRailTabButton({
  label,
  icon,
  danger = false,
  active,
  dirty = false,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  active: boolean;
  dirty?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="student-workspace-panel"
      title={label}
      aria-label={label}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "font-ui relative flex h-11 min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] font-semibold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        active
          ? danger
            ? "bg-red-50 text-red-700"
            : "bg-primary-soft text-primary"
          : danger
            ? "text-gray-600 hover:bg-red-50 hover:text-red-700"
            : "text-gray-600 hover:bg-primary-soft/70 hover:text-primary",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-2 left-0.5 w-0.5 rounded-full",
            danger ? "bg-red-600" : "bg-primary",
          )}
        />
      ) : null}
      {icon}
      <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
      {dirty ? (
        <span
          aria-label="Có thay đổi chưa lưu"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
        />
      ) : null}
    </button>
  );
}

function MobileStudentRailTabButton({
  label,
  icon,
  danger = false,
  active,
  dirty = false,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  active: boolean;
  dirty?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="student-workspace-panel"
      onClick={onSelect}
      className={cn(
        "font-ui relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        active
          ? danger
            ? "bg-red-600 text-white"
            : "bg-primary text-primary-foreground"
          : danger
            ? "text-gray-600 hover:bg-red-50 hover:text-red-600"
            : "text-gray-600 hover:bg-primary-soft/70 hover:text-primary",
      )}
    >
      {icon}
      {label}
      {dirty ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
        />
      ) : null}
    </button>
  );
}

function StudentEnrollmentHistoryPanel({
  enrollments,
  isLoading,
  error,
  onRetry,
}: {
  enrollments: import("@/lib/types").EnrollmentResponse[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50">
        <LoadingLabel label="Đang tải lịch sử lớp học" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-0 flex-1 bg-gray-50 p-5">
        <DataSectionError
          title="Chưa tải được lịch sử lớp học"
          description="Vui lòng thử lại. Hồ sơ học viên vẫn được giữ nguyên."
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      <div className="space-y-3">
        <div>
          <h2 data-workspace-heading tabIndex={-1} className="font-ui text-[15px] font-semibold text-gray-950">
            Lịch sử lớp học
          </h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">
            Các lần ghi danh được giữ lại để tra cứu, kể cả khi học viên đã rời lớp.
          </p>
        </div>
        {enrollments.length === 0 ? (
          <section className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
            Học viên chưa từng được xếp lớp.
          </section>
        ) : (
          enrollments.map((enrollment) => (
            <section key={enrollment.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold text-gray-950">{enrollment.class_name}</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Bắt đầu {formatDate(enrollment.enrollment_date)}
                  </p>
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-1 text-xs font-semibold",
                  enrollment.status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-600",
                )}>
                  {enrollment.status === "active"
                    ? "Đang học"
                    : enrollment.status === "completed"
                      ? "Đã hoàn thành"
                      : enrollment.status === "cancelled"
                        ? "Đã huỷ"
                        : "Đã rời lớp"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-sm">
                <div>
                  <p className="text-gray-500">Học phí áp dụng</p>
                  <p className="mt-0.5 font-semibold tabular-nums text-gray-900">{formatCurrency(enrollment.effective_fee)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Buổi đã chọn</p>
                  <p className="mt-0.5 font-semibold tabular-nums text-gray-900">{enrollment.selected_slot_ids.length || "—"}</p>
                </div>
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function StudentLifecyclePanel({
  student,
  restoring,
  isPending,
  onClose,
  onConfirm,
}: {
  student: StudentResponse;
  restoring: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const normalizedReason = reason.trim();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h2 data-workspace-heading tabIndex={-1} className="text-[15px] font-semibold text-gray-950">
            {student.full_name}
          </h2>
              <p className="mt-1 text-sm tabular-nums text-gray-500">{formatStudentCode(student.student_code)}</p>
          <p className="mt-3 text-sm leading-5 text-gray-600">
            {restoring
              ? "Tiếp nhận lại hồ sơ để xếp lớp mới. Học viên không tự quay lại lớp cũ."
              : "Hồ sơ, công nợ và lịch sử được giữ nguyên. Các lớp đang học sẽ được kết thúc."}
          </p>
          <label htmlFor="student-lifecycle-reason" className="mt-4 block text-sm font-medium text-gray-700">
            Lý do
          </label>
          <textarea
            id="student-lifecycle-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            autoComplete="off"
            rows={3}
            placeholder={restoring ? "Ví dụ: Học viên đăng ký học lại" : "Ví dụ: Chuyển trường"}
            className="mt-1 block min-h-20 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-[15px] leading-5 text-gray-900 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
        </section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">
        <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isPending} onClick={onClose}>Huỷ</Button>
        <PendingActionButton
          type="button"
          isPending={isPending}
          pendingLabel={restoring ? "Đang tiếp nhận" : "Đang xử lý"}
          disabled={!normalizedReason}
          className={cn("h-8 rounded-md px-3 text-sm", !restoring && "bg-red-600 text-white hover:bg-red-700")}
          onClick={() => onConfirm(normalizedReason)}
        >
          {restoring ? "Tiếp nhận lại" : "Ngừng học"}
        </PendingActionButton>
      </div>
    </div>
  );
}

function RemoveFromClassPanel({
  student,
  className,
  dirty,
  isDeleting,
  onClose,
  onConfirm,
}: {
  student: StudentResponse;
  className: string;
  dirty: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isLastActiveClass = student.active_enrollments.length <= 1;

  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h2
            data-workspace-heading
            tabIndex={-1}
            className="font-ui text-[15px] font-semibold leading-5 text-gray-900"
          >
            {student.full_name}
          </h2>
          {student.student_code ? (
            <p className="mt-0.5 text-[13px] font-medium leading-[18px] text-gray-500">
                  Mã: {formatStudentCode(student.student_code)}
            </p>
          ) : null}
          <p className="mt-1 text-[13px] font-medium leading-[18px] text-gray-600">
            Lớp hiện tại: <span className="font-semibold text-gray-800">{className}</span>
          </p>
          {student.active_enrollments.length > 1 ? (
            <p className="mt-0.5 text-[13px] font-medium leading-[18px] text-gray-600">
              Tổng số lớp đang học: {student.active_enrollments.length} lớp
            </p>
          ) : null}
        </section>

        {dirty ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <CloseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="helper-text text-amber-900">
              Bạn đang có thay đổi chưa lưu trong biểu mẫu sửa học viên. Các thay đổi này sẽ không được
              áp dụng nếu học viên rời lớp.
            </p>
          </div>
        ) : null}

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h3 className="font-ui text-sm font-semibold text-destructive">
            Xác nhận rời lớp
          </h3>
          <p className="text-sm leading-6 text-gray-600">
            Học viên <strong className="font-semibold text-gray-800">{student.full_name}</strong> sẽ
            được xoá khỏi lớp <strong className="font-semibold text-gray-800">{className}</strong>.{" "}
            {isLastActiveClass
              ? "Đây là lớp đang học cuối cùng nên hồ sơ sẽ chuyển sang danh sách Đã rời lớp. Lịch sử học phí vẫn được giữ nguyên."
              : "Hồ sơ và các lớp đang học khác vẫn được giữ nguyên."}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={onClose}
              className="h-8 rounded-md px-3 text-sm"
            >
              Huỷ
            </Button>
            <PendingActionButton
              type="button"
              isPending={isDeleting}
              pendingLabel="Đang xử lý"
              disabled={isDeleting}
              onClick={onConfirm}
              className="h-8 rounded-md bg-destructive px-3 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
            >
              Xác nhận rời lớp
            </PendingActionButton>
          </div>
        </section>
      </div>
    </div>
  );
}
