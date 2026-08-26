"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RiWallet3Line as Payroll,
  RiPencilLine as Pencil,
  RiArrowGoBackLine as RotateCcw,
  RiUserUnfollowLine as UserRoundX,
} from "react-icons/ri";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { StaffPayrollContent } from "@/components/staff/staff-payroll-dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { PendingActionButton } from "@/components/ui/pending-action-button";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type { ContactSuggestionSource } from "@/lib/forms/use-contact-pair-suggestion";
import type { PreparedStaffRecord } from "@/lib/staff/presentation";
import type { StaffCreate, StaffUpdate } from "@/lib/types";
import { cn } from "@/lib/utils";

export type StaffWorkspaceMode = "edit" | "payroll" | "status";

type StaffWorkspaceDialogProps = {
  record: PreparedStaffRecord | null;
  initialMode?: StaffWorkspaceMode;
  contactSuggestionSources: ContactSuggestionSource[];
  isSaving: boolean;
  isStatusPending: boolean;
  onClose: () => void;
  onSubmit: (payload: StaffCreate | StaffUpdate) => Promise<void>;
  onStatusChange: (record: PreparedStaffRecord) => void;
};

const MODE_HEADERS: Record<StaffWorkspaceMode, string> = {
  edit: "Chỉnh sửa nhân sự",
  payroll: "Thù lao & tất toán",
  status: "Trạng thái hoạt động",
};

export function StaffWorkspaceDialog({
  record,
  initialMode = "edit",
  contactSuggestionSources,
  isSaving,
  isStatusPending,
  onClose,
  onSubmit,
  onStatusChange,
}: StaffWorkspaceDialogProps) {
  const staff = record?.staff ?? null;
  const isTeacher = staff?.staff_type === "TEACHER";
  const [mode, setMode] = useState<StaffWorkspaceMode>(initialMode);
  const [displayMode, setDisplayMode] = useState<StaffWorkspaceMode>(initialMode);
  const [leaving, setLeaving] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const modeTimerRef = useRef<number | null>(null);
  const pendingModeRef = useRef<StaffWorkspaceMode | null>(null);
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
    if (dirty && !isSaving && !isStatusPending) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, isSaving, isStatusPending, onClose]);

  const { backdropPointerDownRef, dialogRef, requestClose: requestShellClose } =
    useModalDialog({
      isBusy: isSaving || isStatusPending,
      onClose: requestClose,
      suspended: confirmDiscardOpen,
    });

  function changeMode(next: StaffWorkspaceMode) {
    if (!staff) {
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

  if (!record || !staff) {
    return null;
  }

  const roleLabel = staff.staff_type === "TEACHER" ? "Giáo viên" : "Trợ giảng";
  const headerSubtitle = `${staff.full_name} · ${roleLabel}${staff.phone ? ` · ${staff.phone}` : ""}`;

  const rail = (
    <StaffWorkspaceRail
      mode={mode}
      dirty={dirty}
      isTeacher={isTeacher}
      isActive={staff.is_active}
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
        aria-labelledby="staff-workspace-title"
        aria-busy={isSaving || isStatusPending || undefined}
        tabIndex={-1}
        inert={confirmDiscardOpen ? true : undefined}
        data-workspace-dismiss-surface="true"
        className="relative z-10 flex h-full min-h-0 w-full items-stretch justify-center sm:items-center sm:p-4"
      >
        <div className="relative h-full min-h-0 w-full sm:h-[min(680px,calc(100dvh-2rem))] sm:max-w-[640px]">
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none sm:rounded-xl sm:border sm:border-gray-200">
            <FormDialogHeader
              title={MODE_HEADERS[displayMode]}
              subtitle={headerSubtitle}
              titleId="staff-workspace-title"
              onClose={requestShellClose}
              closeDisabled={isSaving || isStatusPending}
            />
            <MobileStaffRail
              mode={mode}
              dirty={dirty}
              isTeacher={isTeacher}
              isActive={staff.is_active}
              onSelect={changeMode}
            />
            <div
              id="staff-workspace-panel"
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
                <StaffFormDialog
                  embedded
                  assignedClassNames={record.assignedClasses.map((c) => c.name)}
                  contactSuggestionSources={contactSuggestionSources}
                  isSaving={isSaving}
                  onClose={requestShellClose}
                  onDirtyChange={setDirty}
                  onSubmit={onSubmit}
                  staff={staff}
                />
              </div>

              <div
                data-workspace-mode="payroll"
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col",
                  displayMode === "payroll"
                    ? "z-10 opacity-100"
                    : "pointer-events-none invisible z-0 opacity-0",
                )}
                aria-hidden={displayMode !== "payroll"}
                inert={displayMode !== "payroll" ? true : undefined}
              >
                <StaffPayrollContent
                  staffId={staff.id}
                  staffName={staff.full_name}
                  onClose={requestShellClose}
                />
              </div>

              {isTeacher ? (
                <div
                  data-workspace-mode="status"
                  className={cn(
                    "absolute inset-0 flex min-h-0 flex-col",
                    displayMode === "status"
                      ? "z-10 opacity-100"
                      : "pointer-events-none invisible z-0 opacity-0",
                  )}
                  aria-hidden={displayMode !== "status"}
                  inert={displayMode !== "status" ? true : undefined}
                >
                  <StaffStatusPanel
                    record={record}
                    dirty={dirty}
                    isStatusPending={isStatusPending}
                    onClose={requestShellClose}
                    onConfirm={() => onStatusChange(record)}
                  />
                </div>
              ) : null}
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
          description="Bạn có thay đổi chưa được lưu trong biểu mẫu nhân sự. Rời khỏi sẽ bỏ qua các thay đổi này."
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

function StaffWorkspaceRail({
  mode,
  dirty,
  isTeacher,
  isActive,
  onSelect,
}: {
  mode: StaffWorkspaceMode;
  dirty: boolean;
  isTeacher: boolean;
  isActive: boolean;
  onSelect: (mode: StaffWorkspaceMode) => void;
}) {
  const items: Array<{
    mode: StaffWorkspaceMode;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    {
      mode: "edit",
      label: "Sửa hồ sơ",
      icon: <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />,
    },
    {
      mode: "payroll",
      label: "Thù lao",
      icon: <Payroll className="h-[18px] w-[18px]" aria-hidden="true" />,
    },
  ];

  if (isTeacher) {
    items.push({
      mode: "status",
      label: isActive ? "Ngừng hoạt động" : "Kích hoạt lại",
      icon: isActive ? (
        <UserRoundX className="h-[18px] w-[18px]" aria-hidden="true" />
      ) : (
        <RotateCcw className="h-[18px] w-[18px]" aria-hidden="true" />
      ),
      danger: isActive,
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem nhân sự"
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
        <StaffRailTabButton
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

function MobileStaffRail({
  mode,
  dirty,
  isTeacher,
  isActive,
  onSelect,
}: {
  mode: StaffWorkspaceMode;
  dirty: boolean;
  isTeacher: boolean;
  isActive: boolean;
  onSelect: (mode: StaffWorkspaceMode) => void;
}) {
  const items: Array<{
    mode: StaffWorkspaceMode;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    {
      mode: "edit",
      label: "Sửa hồ sơ",
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
    },
    {
      mode: "payroll",
      label: "Thù lao",
      icon: <Payroll className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  if (isTeacher) {
    items.push({
      mode: "status",
      label: isActive ? "Ngừng HĐ" : "Kích hoạt",
      icon: isActive ? (
        <UserRoundX className="h-4 w-4" aria-hidden="true" />
      ) : (
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      ),
      danger: isActive,
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Chế độ xem nhân sự"
      className="scrollbar-hidden flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-gray-100/60 px-3 py-1.5 min-[900px]:hidden"
    >
      {items.map((item) => (
        <MobileStaffRailTabButton
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

function StaffRailTabButton({
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
      aria-controls="staff-workspace-panel"
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

function MobileStaffRailTabButton({
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
      aria-controls="staff-workspace-panel"
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

function StaffStatusPanel({
  record,
  dirty,
  isStatusPending,
  onClose,
  onConfirm,
}: {
  record: PreparedStaffRecord;
  dirty: boolean;
  isStatusPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const staff = record.staff;
  const hasActiveClasses = staff.is_active && record.activeClasses.length > 0;

  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-4">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h2
            data-workspace-heading
            tabIndex={-1}
            className="font-ui text-[15px] font-semibold leading-5 text-gray-900"
          >
            {staff.full_name}
          </h2>
          <p className="mt-1 text-[13px] font-medium leading-[18px] text-gray-600">
            Vai trò: Giáo viên · Trạng thái:{" "}
            <span
              className={cn(
                "font-semibold",
                staff.is_active ? "text-emerald-700" : "text-gray-500",
              )}
            >
              {staff.is_active ? "Đang hoạt động" : "Đã ngừng hoạt động"}
            </span>
          </p>
          {record.assignedClasses.length > 0 ? (
            <p className="mt-1 text-[13px] font-medium leading-[18px] text-gray-600">
              Lớp phụ trách: {record.assignedClasses.map((c) => c.name).join(", ")}
            </p>
          ) : null}
        </section>

        {dirty ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="helper-text text-amber-900">
              Bạn đang có thay đổi chưa lưu trong biểu mẫu. Các thay đổi này sẽ không được áp
              dụng nếu chuyển trạng thái.
            </p>
          </div>
        ) : null}

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-200/30">
          <h3 className={cn(
            "font-ui text-sm font-semibold",
            staff.is_active ? "text-destructive" : "text-gray-900",
          )}>
            {staff.is_active ? "Xác nhận ngừng hoạt động" : "Xác nhận kích hoạt lại"}
          </h3>
          <p className="text-sm leading-6 text-gray-600">
            {staff.is_active ? (
              hasActiveClasses ? (
                <span className="font-medium text-destructive">
                  Giáo viên đang phụ trách {record.activeClasses.map((c) => c.name).join(", ")}. Hãy
                  gỡ giáo viên khỏi các lớp này trước khi ngừng hoạt động.
                </span>
              ) : (
                `Giáo viên ${staff.full_name} sẽ được ẩn khỏi danh sách đang hoạt động. Hồ sơ và lịch sử chấm công vẫn được giữ nguyên và có thể kích hoạt lại bất kỳ lúc nào.`
              )
            ) : (
              `Kích hoạt lại giáo viên ${staff.full_name} để tiếp tục phân công vào lớp học và ghi nhận thù lao.`
            )}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isStatusPending}
              onClick={onClose}
              className="h-8 rounded-md px-3 text-sm"
            >
              Huỷ
            </Button>
            <PendingActionButton
              type="button"
              isPending={isStatusPending}
              pendingLabel={staff.is_active ? "Đang ngừng" : "Đang kích hoạt"}
              disabled={hasActiveClasses || isStatusPending}
              onClick={onConfirm}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
                staff.is_active ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90",
              )}
            >
              {staff.is_active ? "Ngừng hoạt động" : "Kích hoạt lại"}
            </PendingActionButton>
          </div>
        </section>
      </div>
    </div>
  );
}
