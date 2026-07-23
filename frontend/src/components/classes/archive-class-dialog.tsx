"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import type { ClassResponse } from "@/lib/types";

export function ArchiveClassDialog({
  class_,
  isArchiving,
  onClose,
  onConfirm,
}: {
  class_: ClassResponse;
  isArchiving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: isArchiving,
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
        aria-busy={isArchiving}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="section-title-text text-gray-900">
          Ngừng hoạt động lớp
        </h2>
        <p id={descriptionId} className="mt-2 text-sm font-normal leading-6 text-gray-600">
          Lớp <strong className="font-semibold text-gray-800">{class_.name}</strong> sẽ được ẩn
          khỏi danh sách đang hoạt động. Hồ sơ học viên và lịch sử học phí vẫn được giữ nguyên;
          các ghi danh hiện tại sẽ được kết thúc.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-sm" disabled={isArchiving} onClick={requestClose}>
            Huỷ
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-8 min-w-[104px] rounded-md bg-red-600 px-3 text-sm text-white hover:bg-red-700"
            disabled={isArchiving}
            onClick={onConfirm}
            data-dialog-autofocus
          >
            <LoadingLabel
              label="Đang xử lý"
              isLoading={isArchiving}
              idleLabel="Ngừng lớp"
            />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
