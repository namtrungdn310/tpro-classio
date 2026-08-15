"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ClassCancelContent } from "@/components/classes/class-cancel-content";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type { ClassResponse } from "@/lib/types";

export function DeleteClassDialog({
  class_,
  isDeleting,
  onClose,
  onConfirm,
}: {
  class_: ClassResponse;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isDeleting,
    onClose,
  });

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isDeleting}
        tabIndex={-1}
        className="relative w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-destructive/15 bg-destructive-soft/60 px-5 py-3.5">
          <h2 id={titleId} className="section-title-text select-none text-destructive">
            Hủy lớp
          </h2>
        </div>
        <div id={descriptionId} className="p-5">
          <ClassCancelContent
            class_={class_}
            isDeleting={isDeleting}
            onCancel={requestClose}
            onConfirm={onConfirm}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
