"use client";

import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  getSlidePanelUnmountDelay,
  useSlidePanelMotion,
} from "@/lib/ui/slide-panel-motion";

import { Button } from "@/components/ui/button";
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

export const FormDialogCloseContext = createContext<() => void>(() => {});
export const useFormDialogClose = () => useContext(FormDialogCloseContext);

export function FormDialogCloseButton({
  children = "Đóng",
  className = "h-8 rounded-md px-4 text-sm font-medium",
  variant = "outline",
  disabled = false,
  onClick,
}: {
  children?: ReactNode;
  className?: string;
  variant?: "outline" | "default" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const requestClose = useFormDialogClose();
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={disabled}
      onClick={() => {
        if (onClick) onClick();
        else requestClose();
      }}
    >
      {children}
    </Button>
  );
}

type FormDialogShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  width?: FormDialogWidth;
  placement?: "center" | "right";
  isBusy?: boolean;
  /** True while the form has unsaved changes; closing asks for confirmation. */
  dirty?: boolean;
  /** Custom title for discard confirmation dialog */
  confirmTitle?: string;
  /** Custom description for discard confirmation dialog */
  confirmDescription?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
  placement = "center",
  isBusy = false,
  dirty = false,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  cancelLabel,
  overlayExtra,
  onClose,
  headerRight,
  suspended = false,
  frameProps,
  children,
}: FormDialogShellProps) {
  const titleId = useId();
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [revealed, setRevealed] = useState(placement !== "right");
  const [isClosing, setIsClosing] = useState(false);
  const isClosingRef = useRef(false);
  const motionDurationRef = useRef(290);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const performClose = useCallback(
    (force = false) => {
      if (isClosingRef.current) return;

      if (!force && dirty && !isBusy) {
        setConfirmDiscardOpen(true);
        return;
      }

      if (placement !== "right") {
        onClose();
        return;
      }

      isClosingRef.current = true;
      setIsClosing(true);
      setRevealed(false);

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const delay = getSlidePanelUnmountDelay(
        motionDurationRef.current,
        prefersReducedMotion,
      );

      closeTimerRef.current = window.setTimeout(() => {
        onClose();
      }, delay);
    },
    [dirty, isBusy, onClose, placement],
  );

  const requestShellClose = useCallback(() => {
    performClose(false);
  }, [performClose]);

  const { backdropPointerDownRef, dialogRef, requestClose: modalRequestClose } =
    useModalDialog({
      isBusy,
      onClose: requestShellClose,
      suspended: suspended || confirmDiscardOpen,
    });
  const motion = useSlidePanelMotion(dialogRef, placement === "right");

  useEffect(() => {
    motionDurationRef.current = motion.durationMs;
  }, [motion.durationMs]);

  useEffect(() => {
    if (placement !== "right" || !motion.isReady) return;
    let innerFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        setRevealed(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (innerFrame !== null) {
        window.cancelAnimationFrame(innerFrame);
      }
    };
  }, [placement, motion.isReady]);

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        placement === "right"
          ? "items-stretch justify-end overflow-hidden"
          : "items-stretch justify-center p-0 sm:items-center sm:p-4 bg-black/30",
        isClosing && "pointer-events-none",
      )}
      {...(placement !== "right"
        ? {
            onPointerDown: (event) => {
              backdropPointerDownRef.current =
                event.target === event.currentTarget;
            },
            onPointerUp: (event) => {
              if (
                backdropPointerDownRef.current &&
                event.target === event.currentTarget
              ) {
                modalRequestClose();
              }
              backdropPointerDownRef.current = false;
            },
            onPointerCancel: () => {
              backdropPointerDownRef.current = false;
            },
          }
        : {})}
    >
      {placement === "right" ? (
        <div
          aria-hidden="true"
          style={getSlideBackdropStyle(motion.durationMs)}
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity motion-reduce:transition-none",
            revealed ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onPointerDown={(event) => {
            backdropPointerDownRef.current =
              event.target === event.currentTarget;
          }}
          onPointerUp={(event) => {
            if (
              backdropPointerDownRef.current &&
              event.target === event.currentTarget
            ) {
              modalRequestClose();
            }
            backdropPointerDownRef.current = false;
          }}
          onPointerCancel={() => {
            backdropPointerDownRef.current = false;
          }}
        />
      ) : null}

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
          placement === "right" &&
            "relative z-10 sm:h-full sm:max-h-full sm:rounded-none transition-transform motion-reduce:transition-none",
          placement === "right" &&
            (revealed ? "translate-x-0" : "translate-x-full"),
        )}
        style={
          placement === "right"
            ? { ...getSlidePanelStyle(motion.durationMs), ...frameProps?.style }
            : frameProps?.style
        }
      >
        <FormDialogHeader
          title={title}
          subtitle={subtitle}
          titleId={titleId}
          onClose={modalRequestClose}
          closeDisabled={isBusy}
          right={headerRight}
        />
        <FormDialogCloseContext.Provider value={requestShellClose}>
          {children}
        </FormDialogCloseContext.Provider>
      </div>
      {overlayExtra}
      {confirmDiscardOpen ? (
        <ConfirmationDialog
          open
          title={confirmTitle ?? "Thay đổi chưa được lưu"}
          description={
            confirmDescription ??
            "Nếu rời khỏi, các thay đổi trong biểu mẫu sẽ bị mất."
          }
          confirmLabel={confirmLabel ?? "Rời khỏi"}
          cancelLabel={cancelLabel ?? "Tiếp tục chỉnh sửa"}
          tone="danger"
          isPending={isBusy}
          onCancel={() => setConfirmDiscardOpen(false)}
          onConfirm={() => {
            setConfirmDiscardOpen(false);
            performClose(true);
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
