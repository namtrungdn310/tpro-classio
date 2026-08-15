"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RiArrowRightSLine as ChevronRight } from "react-icons/ri";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { useModalDialog } from "@/lib/hooks/useModalDialog";

export type EntityActionItem = {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onClick: () => void;
};

export type EntityActionsDialogProps = {
  open: boolean;
  title: string;
  actions: EntityActionItem[];
  onClose: () => void;
};

export function EntityActionsDialog(props: EntityActionsDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !props.open) {
    return null;
  }

  return <EntityActionsDialogContent {...props} />;
}

function EntityActionsDialogContent({ title, actions, onClose }: EntityActionsDialogProps) {
  const titleId = useId();
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy: false,
    onClose,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex select-none overflow-y-auto bg-black/30 px-4 py-6"
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
        tabIndex={-1}
        className="relative m-auto w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <FormDialogHeader title={title} titleId={titleId} onClose={requestClose} />
        <div className="p-4">
          {actions.length > 0 ? (
            <div className="space-y-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-3 text-left transition hover:border-primary/30 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  {action.icon ? (
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                        action.tone === "danger"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {action.icon}
                    </span>
                  ) : null}
                  <span
                    className={`min-w-0 flex-1 text-[15px] font-semibold leading-5 ${
                      action.tone === "danger" ? "text-destructive" : "text-gray-900"
                    }`}
                  >
                    {action.label}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-600"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="px-1 py-6 text-center text-sm font-medium text-gray-500">
              Không có thao tác nào khả dụng
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
