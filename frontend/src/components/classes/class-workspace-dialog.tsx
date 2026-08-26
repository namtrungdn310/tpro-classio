"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RiBookOpenLine as BookOpen,
  RiCalendarCheckLine as CalendarCheck,
  RiCloseCircleLine as CloseCircle,
  RiPencilLine as Pencil,
  RiShareForwardLine as ContinueClass,
} from "react-icons/ri";
import { ClassCancelContent } from "@/components/classes/class-cancel-content";
import { ClassFormDialog } from "@/components/classes/class-form-dialog";
import { ClassHistoryContent } from "@/components/classes/class-history-slide";
import { ClassMakeupWorkspace } from "@/components/classes/class-makeup-workspace";
import { ClassContinuationWorkspace } from "@/components/classes/class-continuation-workspace";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DataSectionError } from "@/components/ui/data-section-state";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { LoadingLabel } from "@/components/ui/loading-label";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getClassHistory } from "@/lib/api/classes";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useQuery } from "@tanstack/react-query";
import type { ClassContinuationCreate, ClassHistory, ClassResponse, ClassUpdate, TeacherOptionResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

type WorkspaceMode = "edit" | "history" | "cancel" | "makeup" | "continuation";

type ClassWorkspaceDialogProps = {
  class_: ClassResponse | null;
  initialMode: "edit" | "history" | "makeup";
  showModeRail: boolean;
  canEdit: boolean;
  canContinue: boolean;
  isSaving: boolean;
  isContinuing: boolean;
  isDeleting: boolean;
  isTeachersError: boolean;
  isTeachersLoading: boolean;
  onClose: () => void;
  onRetryTeachers: () => void;
  onSubmit: (payload: ClassUpdate) => void;
  onCreateContinuation: (payload: ClassContinuationCreate) => void;
  onCancelClass: () => void;
  onPostponed?: () => void;
  teachers: TeacherOptionResponse[];
};

const MODE_HEADERS: Record<WorkspaceMode, string> = {
  edit: "Sửa lớp học",
  history: "Hồ sơ lớp",
  cancel: "Hủy lớp",
  makeup: "Hoãn lớp",
  continuation: "Tạo lớp kế tiếp",
};

export function ClassWorkspaceDialog({
  class_,
  initialMode,
  showModeRail,
  canEdit,
  canContinue,
  isSaving,
  isContinuing,
  isDeleting,
  isTeachersError,
  isTeachersLoading,
  onClose,
  onRetryTeachers,
  onSubmit,
  onCreateContinuation,
  onCancelClass,
  onPostponed,
  teachers,
}: ClassWorkspaceDialogProps) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [displayMode, setDisplayMode] = useState<WorkspaceMode>(initialMode);
  const [leaving, setLeaving] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [nestedOverlayOpen, setNestedOverlayOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const modeTimerRef = useRef<number | null>(null);
  const pendingModeRef = useRef<WorkspaceMode | null>(null);
  const reducedMotionRef = useRef(false);

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
    if (dirty && !isSaving && !isDeleting && !isContinuing) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, isSaving, isDeleting, isContinuing, onClose]);

  const { backdropPointerDownRef, dialogRef, requestClose: requestShellClose } =
    useModalDialog({
      isBusy: isSaving || isDeleting || isContinuing,
      onClose: requestClose,
      suspended: nestedOverlayOpen || confirmDiscardOpen,
    });

  const historyQuery = useQuery({
    queryKey: classQueryKeys.history(class_!.id),
    queryFn: () => getClassHistory(class_!.id),
    enabled: Boolean(class_ && mode === "history"),
    staleTime: 30_000,
    retry: false,
  });

  function changeMode(next: WorkspaceMode) {
    if (!class_) {
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
  }, [displayMode, initialMode]);

  if (!class_) {
    return null;
  }

  const headerSubtitle = `${class_.primary_label} · ${formatDate(class_.start_date)} – ${formatDate(class_.end_date)}`;

  const rail = showModeRail ? (
    <ClassWorkspaceRail
      mode={mode}
      dirty={dirty}
      canCancel={Boolean(class_.can_cancel)}
      canMakeup={Boolean(class_.can_edit)}
      canEdit={canEdit}
      canContinue={canContinue}
      onSelect={changeMode}
    />
  ) : null;

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
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/35"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-workspace-title"
        aria-busy={isSaving || isDeleting || isContinuing || undefined}
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
              titleId="class-workspace-title"
              onClose={requestShellClose}
              closeDisabled={isSaving || isDeleting || isContinuing}
            />
            {rail ? <MobileModeRail mode={mode} dirty={dirty} canCancel={Boolean(class_.can_cancel)} canMakeup={Boolean(class_.can_edit)} canEdit={canEdit} canContinue={canContinue} onSelect={changeMode} /> : null}
            <div
              id="class-workspace-panel"
              role="tabpanel"
              aria-label={MODE_HEADERS[displayMode]}
              ref={panelRef}
              className={cn(
                "relative min-h-0 flex-1",
                leaving ? "workspace-panel-out" : animateIn ? "workspace-panel-in" : "",
              )}
            >
            {showModeRail && canEdit ? (
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
                <ClassFormDialog
                  embedded
                  class_={class_}
                  isSaving={isSaving}
                  isTeachersError={isTeachersError}
                  isTeachersLoading={isTeachersLoading}
                  onClose={requestShellClose}
                  onDirtyChange={setDirty}
                  onNestedOverlayChange={setNestedOverlayOpen}
                  onRetryTeachers={onRetryTeachers}
                  onSubmit={onSubmit}
                  teachers={teachers}
                />
              </div>
            ) : null}
            {showModeRail && canContinue ? (
              <div
                data-workspace-mode="continuation"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "continuation" ? "z-10 opacity-100" : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "continuation"}
                inert={displayMode !== "continuation" ? true : undefined}
              >
                <ClassContinuationWorkspace
                  sourceClass={class_}
                  active={displayMode === "continuation"}
                  teachers={teachers}
                  isTeachersLoading={isTeachersLoading}
                  isTeachersError={isTeachersError}
                  isSaving={isContinuing}
                  onClose={requestShellClose}
                  onRetryTeachers={onRetryTeachers}
                  onDirtyChange={setDirty}
                  onNestedOverlayChange={setNestedOverlayOpen}
                  onSubmit={onCreateContinuation}
                />
              </div>
            ) : null}
            {displayMode === "edit" && !showModeRail ? (
              <div data-workspace-mode="edit" className="absolute inset-0 z-10 flex min-h-0 flex-col">
                <ClassFormDialog
                  embedded
                  class_={class_}
                  isSaving={isSaving}
                  isTeachersError={isTeachersError}
                  isTeachersLoading={isTeachersLoading}
                  onClose={requestShellClose}
                  onDirtyChange={setDirty}
                  onNestedOverlayChange={setNestedOverlayOpen}
                  onRetryTeachers={onRetryTeachers}
                  onSubmit={onSubmit}
                  teachers={teachers}
                />
              </div>
            ) : null}
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
              <HistoryPanel
                class_={class_}
                data={historyQuery.data}
                errorMessage={
                  historyQuery.isError
                    ? getApiErrorMessage(historyQuery.error, "Không thể tải lịch sử lớp.")
                    : null
                }
                isLoading={historyQuery.isPending}
                onRetry={() => void historyQuery.refetch()}
              />
            </div>
            {showModeRail ? (
              <div
                data-workspace-mode="cancel"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "cancel"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "cancel"}
                inert={displayMode !== "cancel" ? true : undefined}
              >
                <CancelPanel
                  class_={class_}
                  dirty={dirty}
                  isDeleting={isDeleting}
                  onClose={requestShellClose}
                  onConfirm={onCancelClass}
                />
              </div>
            ) : null}
            {showModeRail ? (
              <div
                data-workspace-mode="makeup"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "makeup"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "makeup"}
                inert={displayMode !== "makeup" ? true : undefined}
              >
                <ClassMakeupWorkspace
                  class_={class_}
                  isSaving={isSaving}
                  onClose={requestShellClose}
                  onNestedOverlayChange={setNestedOverlayOpen}
                  onPostponed={onPostponed}
                />
              </div>
            ) : null}
            </div>
          </div>
          {rail ? <div className="workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-[900px]:block">{rail}</div> : null}
        </div>
      </div>
      {confirmDiscardOpen ? (
        <ConfirmationDialog
          open
          title="Thay đổi chưa được lưu"
          description="Bạn có thay đổi chưa được lưu trong biểu mẫu sửa lớp. Rời khỏi sẽ bỏ qua các thay đổi này."
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

function ClassWorkspaceRail({
  mode,
  dirty,
  canCancel,
  canMakeup,
  canEdit,
  canContinue,
  onSelect,
}: {
  mode: WorkspaceMode;
  dirty: boolean;
  canCancel: boolean;
  canMakeup: boolean;
  canEdit: boolean;
  canContinue: boolean;
  onSelect: (mode: WorkspaceMode) => void;
}) {
  const items: Array<{ mode: WorkspaceMode; label: string; icon: React.ReactNode; danger?: boolean }> = [
    { mode: "history", label: "Xem hồ sơ", icon: <BookOpen className="h-[18px] w-[18px]" aria-hidden="true" /> },
  ];
  if (canEdit) items.push({ mode: "edit", label: "Sửa lớp", icon: <Pencil className="h-[18px] w-[18px]" aria-hidden="true" /> });
  if (canContinue) items.push({ mode: "continuation", label: "Tạo lớp kế tiếp", icon: <ContinueClass className="h-[18px] w-[18px]" aria-hidden="true" /> });
  if (canMakeup) {
    items.push({ mode: "makeup", label: "Hoãn lớp", icon: <CalendarCheck className="h-[18px] w-[18px]" aria-hidden="true" /> });
  }
  if (canCancel) {
    items.push({ mode: "cancel", label: "Hủy lớp", icon: <CloseCircle className="h-[18px] w-[18px]" aria-hidden="true" />, danger: true });
  }

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem lớp"
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
      className="flex w-[176px] shrink-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/15"
    >
      {items.map((item) => (
        <RailTabButton
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

function MobileModeRail({
  mode,
  dirty,
  canCancel,
  canMakeup,
  canEdit,
  canContinue,
  onSelect,
}: {
  mode: WorkspaceMode;
  dirty: boolean;
  canCancel: boolean;
  canMakeup: boolean;
  canEdit: boolean;
  canContinue: boolean;
  onSelect: (mode: WorkspaceMode) => void;
}) {
  const items: Array<{ mode: WorkspaceMode; label: string; icon: React.ReactNode; danger?: boolean }> = [
    { mode: "history", label: "Hồ sơ", icon: <BookOpen className="h-4 w-4" aria-hidden="true" /> },
  ];
  if (canEdit) items.push({ mode: "edit", label: "Sửa lớp", icon: <Pencil className="h-4 w-4" aria-hidden="true" /> });
  if (canContinue) items.push({ mode: "continuation", label: "Lớp kế tiếp", icon: <ContinueClass className="h-4 w-4" aria-hidden="true" /> });
  if (canMakeup) {
    items.push({ mode: "makeup", label: "Hoãn lớp", icon: <CalendarCheck className="h-4 w-4" aria-hidden="true" /> });
  }
  if (canCancel) {
    items.push({ mode: "cancel", label: "Hủy lớp", icon: <CloseCircle className="h-4 w-4" aria-hidden="true" />, danger: true });
  }

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem lớp"
      className="scrollbar-hidden flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-gray-100/60 px-3 py-1.5 min-[900px]:hidden"
    >
      {items.map((item) => (
        <MobileRailTabButton
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

function RailTabButton({
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
      aria-controls="class-workspace-panel"
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
      {active ? <span aria-hidden="true" className={cn("absolute inset-y-2 left-0.5 w-0.5 rounded-full", danger ? "bg-red-600" : "bg-primary")} /> : null}
      {icon}
      <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
      {dirty ? (
        <span aria-label="Có thay đổi chưa lưu" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      ) : null}
    </button>
  );
}

function MobileRailTabButton({
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
      aria-controls="class-workspace-panel"
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
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
      ) : null}
    </button>
  );
}

function HistoryPanel({
  class_,
  data,
  errorMessage,
  isLoading,
  onRetry,
}: {
  class_: ClassResponse;
  data: ClassHistory | undefined;
  errorMessage: string | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      <h2 data-workspace-heading tabIndex={-1} className="sr-only">
        Hồ sơ lớp {class_.primary_label}
      </h2>
      {isLoading ? (
        <div aria-busy="true" className="flex min-h-48 items-center justify-center text-sm font-medium text-gray-600">
          <LoadingLabel label="Đang tải lịch sử" />
        </div>
      ) : null}
      {errorMessage ? (
        <DataSectionError
          title="Không tải được hồ sơ lớp"
          description={errorMessage}
          onRetry={onRetry}
        />
      ) : null}
      {data && !errorMessage ? <ClassHistoryContent data={data} /> : null}
    </div>
  );
}

function CancelPanel({
  class_,
  dirty,
  isDeleting,
  onClose,
  onConfirm,
}: {
  class_: ClassResponse;
  dirty: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h2 data-workspace-heading tabIndex={-1} className="font-ui text-[15px] font-semibold leading-5 text-gray-900">
            {class_.primary_label}
          </h2>
          <p className="mt-1 text-[13px] font-medium leading-[18px] tabular-nums text-gray-600">
            {formatDate(class_.start_date)} – {formatDate(class_.end_date)}
          </p>
          <p className="mt-0.5 text-[13px] font-medium leading-[18px] tabular-nums text-gray-600">
            {class_.student_count} học viên hiện tại
          </p>
        </section>
        {dirty ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <CloseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="helper-text text-amber-900">
              Bạn đang có thay đổi chưa lưu. Các thay đổi này sẽ không được áp dụng nếu hủy lớp.
            </p>
          </div>
        ) : null}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <ClassCancelContent
            class_={class_}
            isDeleting={isDeleting}
            onCancel={onClose}
            onConfirm={onConfirm}
          />
        </section>
      </div>
    </div>
  );
}
