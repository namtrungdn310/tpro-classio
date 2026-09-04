"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { UnsavedChangesNotice } from "@/components/ui/unsaved-changes-notice";
import { StudentLearningHistory } from "@/components/students/student-learning-history";
import { getStudentEnrollments } from "@/lib/api/students";
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
  onRestore?: (reason: string, expected_updated_at?: string) => void;
  renderEditPanel: (props: {
    embedded: boolean;
    onDirtyChange: (dirty: boolean) => void;
    onNestedOverlayChange: (open: boolean) => void;
    onClose: () => void;
  }) => React.ReactNode;
};

const MODE_HEADERS: Record<StudentWorkspaceMode, string> = {
  edit: "Chỉnh sửa học viên",
  history: "Lịch sử học tập",
  remove: "Rời lớp",
  archive: "Ngừng học",
  restore: "Học lại tại trung tâm",
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
    staleTime: 10 * 60_000,
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
                <StudentLearningHistory
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
                  restoring={student.status === "archived"}
                  isPending={isLifecyclePending}
                  onClose={requestShellClose}
                  onConfirm={(reason) =>
                    student.status === "archived"
                      ? onRestore?.(reason, student.updated_at)
                      : onArchive?.(reason)
                  }
                />
              </div>
            </div>
          </div>
          <div className="workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-[900px]:block">
            {rail}
          </div>
        </div>
      </div>

      {confirmDiscardOpen ? (
        <ConfirmationDialog
          open
          title="Thay đổi chưa được lưu"
          description="Nếu rời khỏi, các thay đổi trong biểu mẫu sẽ bị mất."
          confirmLabel="Rời khỏi"
          cancelLabel="Tiếp tục chỉnh sửa"
          tone="danger"
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
    danger?: boolean;
  }> = [
    ...(!isArchived ? [{
      mode: "edit",
      label: "Sửa học viên",
    } as const] : []),
    {
      mode: "history",
      label: "Lịch sử học tập",
    },
    ...(canRemove ? [{
      mode: "remove",
      label: "Rời lớp",
      danger: true,
    } as const] : []),
    {
      mode: isArchived ? "restore" : "archive",
      label: isArchived ? "Học lại" : "Ngừng học",
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
      className="flex w-max max-w-[calc(100vw-2rem)] shrink-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-gray-900/15"
    >
      {items.map((item) => (
        <StudentRailTabButton
          key={item.mode}
          label={item.label}
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
    danger?: boolean;
  }> = [
    ...(!isArchived ? [{
      mode: "edit",
      label: "Sửa học viên",
    } as const] : []),
    {
      mode: "history",
      label: "Lịch sử lớp",
    },
    ...(canRemove ? [{
      mode: "remove",
      label: "Rời lớp",
      danger: true,
    } as const] : []),
    {
      mode: isArchived ? "restore" : "archive",
      label: isArchived ? "Học lại" : "Ngừng học",
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
  danger = false,
  active,
  dirty = false,
  onSelect,
}: {
  label: string;
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
        "font-ui relative flex h-9 min-h-9 w-full cursor-pointer items-center justify-start overflow-hidden rounded-lg pl-4 pr-3.5 py-1.5 text-left text-[14px] font-semibold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
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
            "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full",
            danger ? "bg-red-600" : "bg-primary",
          )}
        />
      ) : null}
      <span className="whitespace-nowrap">{label}</span>
      {dirty ? (
        <span
          aria-label="Có thay đổi chưa lưu"
          className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
        />
      ) : null}
    </button>
  );
}

function MobileStudentRailTabButton({
  label,
  danger = false,
  active,
  dirty = false,
  onSelect,
}: {
  label: string;
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
        "font-ui relative inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md px-2.5 text-[13px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        active
          ? danger
            ? "bg-red-600 text-white"
            : "bg-primary text-primary-foreground"
          : danger
            ? "text-gray-600 hover:bg-red-50 hover:text-red-600"
            : "text-gray-600 hover:bg-primary-soft/70 hover:text-primary",
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      {dirty ? (
        <span
          aria-label="Có thay đổi chưa lưu"
          className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
        />
      ) : null}
    </button>
  );
}

function StudentLifecyclePanel({
  restoring,
  isPending,
  onClose,
  onConfirm,
}: {
  restoring: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const normalizedReason = reason.trim();

  let errorMessage: string | null = null;
  if (submitAttempted) {
    if (!normalizedReason) {
      errorMessage = restoring
        ? "Vui lòng nhập lý do học lại."
        : "Vui lòng nhập lý do ngừng học.";
    } else if (normalizedReason.length < 3) {
      errorMessage = restoring
        ? "Lý do học lại phải có ít nhất 3 ký tự."
        : "Lý do ngừng học phải có ít nhất 3 ký tự.";
    } else if (normalizedReason.length > 500) {
      errorMessage = "Lý do không được vượt quá 500 ký tự.";
    }
  } else if (reason.length > 0) {
    if (normalizedReason.length < 3) {
      errorMessage = restoring
        ? "Lý do học lại phải có ít nhất 3 ký tự."
        : "Lý do ngừng học phải có ít nhất 3 ký tự.";
    } else if (normalizedReason.length > 500) {
      errorMessage = "Lý do không được vượt quá 500 ký tự.";
    }
  }

  function handleSubmit(event?: React.FormEvent) {
    if (event) {
      event.preventDefault();
    }
    setSubmitAttempted(true);
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      return;
    }
    onConfirm(normalizedReason);
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="rounded-xl border border-gray-200 bg-white px-4 shadow-sm shadow-gray-200/30">
          <h2
            data-workspace-heading
            tabIndex={-1}
            className="border-b border-gray-100 py-3 text-[15px] font-semibold text-gray-950"
          >
            {restoring ? "Sau khi học lại" : "Sau khi xác nhận"}
          </h2>
          <dl>
            <LifecycleSummaryRow label="Trạng thái">
              {restoring
                ? "Chuyển sang Học viên chưa xếp lớp"
                : "Chuyển sang Học viên ngừng học trung tâm"}
            </LifecycleSummaryRow>
            <LifecycleSummaryRow label="Lớp học">
              {restoring ? "Không tự quay lại lớp cũ" : "Kết thúc các lớp đang học"}
            </LifecycleSummaryRow>
            <LifecycleSummaryRow label="Dữ liệu">
              Giữ nguyên mã học viên, học phí và lịch sử học tập
            </LifecycleSummaryRow>
          </dl>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <label htmlFor="student-lifecycle-reason" className="form-label-text block select-none text-gray-800">
            {restoring ? "Lý do học lại" : "Lý do"}
          </label>
          <textarea
            id="student-lifecycle-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            autoComplete="off"
            rows={3}
            aria-invalid={Boolean(errorMessage)}
            aria-describedby={errorMessage ? "student-lifecycle-reason-error" : undefined}
            placeholder={restoring ? "Ví dụ: Học viên đăng ký học lại" : "Ví dụ: Chuyển trường"}
            className="mt-1.5 block min-h-20 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-[15px] leading-5 text-gray-900 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/15 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:border-red-600 aria-[invalid=true]:focus:ring-red-200"
          />
          {errorMessage ? (
            <p
              id="student-lifecycle-reason-error"
              role="alert"
              className="mt-1.5 text-sm font-medium text-red-600"
            >
              {errorMessage}
            </p>
          ) : null}
        </section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">
        <Button
          type="button"
          variant="outline"
          className="h-8 rounded-md px-3 text-sm"
          disabled={isPending}
          onClick={onClose}
        >
          Huỷ
        </Button>
        <PendingActionButton
          type="submit"
          isPending={isPending}
          pendingLabel={restoring ? "Đang cập nhật" : "Đang xử lý"}
          className={cn(
            "h-8 rounded-md px-3 text-sm font-medium",
            restoring
              ? "bg-primary text-white hover:bg-primary-hover"
              : "bg-red-600 text-white hover:bg-red-700",
          )}
        >
          {restoring ? "Xác nhận học lại" : "Ngừng học"}
        </PendingActionButton>
      </div>
    </form>
  );
}

function RemoveFromClassPanel({
  student,
  dirty,
  isDeleting,
  onClose,
  onConfirm,
}: {
  student: StudentResponse;
  className?: string;
  dirty: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isLastActiveClass = student.active_enrollments.length <= 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <UnsavedChangesNotice
          hasChanges={dirty}
          isSaving={isDeleting}
          message={
            <>
              Bạn đang có thay đổi chưa lưu trong biểu mẫu sửa học viên. Các thay đổi này sẽ không được
              áp dụng nếu học viên rời lớp.
            </>
          }
        />

        <section className="rounded-xl border border-gray-200 bg-white px-4 shadow-sm shadow-gray-200/30">
          <h2
            data-workspace-heading
            tabIndex={-1}
            className="border-b border-gray-100 py-3 text-[15px] font-semibold text-destructive"
          >
            Sau khi xác nhận
          </h2>
          <dl>
            <LifecycleSummaryRow label="Hồ sơ">
              {isLastActiveClass
                ? "Chuyển sang Học viên chưa xếp lớp"
                : `Tiếp tục học ${student.active_enrollments.length - 1} lớp khác`}
            </LifecycleSummaryRow>
            <LifecycleSummaryRow label="Dữ liệu">
              Học phí và lịch sử học tập được giữ nguyên
            </LifecycleSummaryRow>
          </dl>
        </section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">
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
    </div>
  );
}

function LifecycleSummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 border-b border-gray-100 py-3 last:border-b-0">
      <dt className="text-[13px] font-medium leading-5 text-gray-500">{label}</dt>
      <dd className="text-sm font-medium leading-5 text-gray-800">{children}</dd>
    </div>
  );
}
