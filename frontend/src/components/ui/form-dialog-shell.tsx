"use client";

import { createPortal } from "react-dom";
import { useCallback, useId, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import { cn } from "@/lib/utils";

export type FormDialogWidth = "sm" | "md" | "standard" | "lg" | "xl";

const DIALOG_WIDTH_CLASS: Record<FormDialogWidth, string> = {
  sm: "sm:max-w-[440px]",
  md: "sm:max-w-[560px]",
  standard: "sm:max-w-[640px]",
  lg: "sm:max-w-[720px]",
  xl: "sm:max-w-[1000px]",
};

/** Desktop size shared by entity-creation dialogs; mobile remains full-screen. */
export const createEntityDialogFrameClassName =
  "sm:h-[min(680px,calc(100dvh-2rem))]";

/**
 * Desktop envelope shared by substantial edit/help dialogs. It remains compact
 * on large screens and leaves long content to the dialog's single scroll body.
 */
export const editEntityDialogFrameClassName =
  "sm:h-[min(680px,calc(100dvh-2rem))]";

type FormDialogShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  width?: FormDialogWidth;
  isBusy?: boolean;
  /** True while the form has unsaved changes; closing asks for confirmation. */
  dirty?: boolean;
  /** Extra overlay content rendered above the frame, e.g. picker slides. */
  overlayExtra?: ReactNode;
  onClose: () => void;
  headerRight?: ReactNode;
  /** Suspends Escape/backdrop close while a nested overlay is open. */
  suspended?: boolean;
  frameProps?: Omit<
    ComponentPropsWithoutRef<"div">,
    "ref" | "role" | "aria-modal" | "aria-labelledby" | "tabIndex"
  >;
  children: ReactNode;
};

/**
 * Shared add/edit dialog frame: one overlay, one scroll owner, a fixed header
 * and a fixed footer. Sections inside get auto-numbered chapter labels.
 * Closing with unsaved changes asks for confirmation before leaving.
 */
export function FormDialogShell({
  title,
  subtitle,
  width = "md",
  isBusy = false,
  dirty = false,
  overlayExtra,
  onClose,
  headerRight,
  suspended = false,
  frameProps,
  children,
}: FormDialogShellProps) {
  const titleId = useId();
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty && !isBusy) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, isBusy, onClose]);

  const { backdropPointerDownRef, dialogRef, requestClose: requestShellClose } =
    useModalDialog({
      isBusy,
      onClose: requestClose,
      suspended: suspended || confirmDiscardOpen,
    });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestShellClose();
        }
        backdropPointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isBusy || undefined}
        tabIndex={-1}
        {...frameProps}
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden bg-white shadow-xl outline-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl",
          DIALOG_WIDTH_CLASS[width],
          frameProps?.className,
        )}
      >
        <FormDialogHeader
          title={title}
          subtitle={subtitle}
          titleId={titleId}
          onClose={requestShellClose}
          closeDisabled={isBusy}
          right={headerRight}
        />
        {children}
      </div>
      {overlayExtra}
      {confirmDiscardOpen ? (
        <ConfirmationDialog
          open
          title="Thay đổi chưa được lưu"
          description="Nếu rời khỏi, các thay đổi trong biểu mẫu sẽ bị mất."
          confirmLabel="Rời khỏi"
          cancelLabel="Tiếp tục chỉnh sửa"
          tone="danger"
          isPending={isBusy}
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

/** The single scroll owner between the fixed header and fixed footer. */
type FormDialogBodyProps = {
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">;

export function FormDialogBody({
  children,
  className,
  ...props
}: FormDialogBodyProps) {
  return (
    <div
      {...props}
      className={cn(
        "scrollbar-hidden min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Fixed dialog footer: unsaved-state slot on the left, actions on the right. */
export function FormDialogFooter({
  left,
  right,
  children,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{left}</div>
      <div className="flex shrink-0 items-center justify-end gap-2">{right ?? children}</div>
    </footer>
  );
}
