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

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4"
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
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="section-title-text text-gray-900">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm font-normal leading-6 text-gray-600">
          {description}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-md px-3 text-sm"
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
                ? "h-8 rounded-md bg-red-600 px-3 text-sm text-white hover:bg-red-700"
                : "h-8 rounded-md bg-gray-950 px-3 text-sm text-white hover:bg-black"
            }
            disabled={isPending}
            onClick={onConfirm}
            data-dialog-autofocus={!focusCancelFirst || undefined}
          >
            <LoadingLabel
              label="Đang xử lý"
              isLoading={isPending}
              idleLabel={confirmLabel}
            />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
