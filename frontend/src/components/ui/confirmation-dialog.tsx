"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { useModalDialog } from "@/lib/hooks/useModalDialog";

export type ConfirmationDialogProps = {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog(props: ConfirmationDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !props.open) {
    return null;
  }

  return <ConfirmationDialogContent {...props} />;
}

function ConfirmationDialogContent({
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Huỷ",
  tone = "default",
  isPending = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isPending,
    onClose: onCancel,
  });
  const focusCancelFirst = tone === "danger";
  const activePendingLabel = pendingLabel ?? (confirmLabel === "Hoàn tác" ? "Đang hoàn tác" : "Đang xử lý");

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex select-none items-center justify-center bg-black/30 px-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestClose();
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
        aria-describedby={descriptionId}
        aria-busy={isPending || undefined}
        tabIndex={-1}
        className="relative w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className={`border-b px-5 py-3.5 ${tone === "danger" ? "border-destructive/15 bg-destructive-soft/60" : "border-primary/15 bg-primary-soft/60"}`}>
          <h2
            id={titleId}
            className={`section-title-text select-none ${tone === "danger" ? "text-destructive" : "text-primary"}`}
          >
            {title}
          </h2>
        </div>
        <div className="p-5">
          <div id={descriptionId} className="text-sm font-normal leading-6 text-gray-600">
            {description}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-md px-3 text-xs font-medium"
              disabled={isPending}
              onClick={requestClose}
              data-dialog-autofocus={focusCancelFirst || undefined}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={tone === "danger" ? "destructive" : "default"}
              className={
                tone === "danger"
                  ? "h-8 rounded-md bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-[width,padding,background-color] hover:bg-destructive/90 disabled:opacity-80"
                  : "h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-[width,padding,background-color] hover:bg-primary/90 disabled:opacity-80"
              }
              disabled={isPending}
              onClick={onConfirm}
              data-dialog-autofocus={!focusCancelFirst || undefined}
            >
              {isPending ? (
                <LoadingLabel label={activePendingLabel} />
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
