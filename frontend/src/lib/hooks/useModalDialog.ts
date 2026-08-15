"use client";

import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { clearDocumentTextSelection } from "@/lib/ui/action-selection";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isFocusableVisible(element: HTMLElement): boolean {
  if (element.closest("[inert], [aria-hidden='true']")) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isFocusableVisible,
  );
}

export function useModalDialog({
  focusContainerInitially = false,
  isBusy,
  onClose,
  suspended = false,
}: {
  focusContainerInitially?: boolean;
  isBusy: boolean;
  onClose: () => void;
  suspended?: boolean;
}): {
  backdropPointerDownRef: MutableRefObject<boolean>;
  dialogRef: RefObject<HTMLDivElement>;
  requestClose: () => void;
} {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPointerDownRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (!isBusy && !suspended) {
      clearDocumentTextSelection();
      onClose();
    }
  }, [isBusy, onClose, suspended]);

  useEffect(() => {
    clearDocumentTextSelection();
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (focusContainerInitially) {
        dialogRef.current?.focus();
        clearDocumentTextSelection();
        return;
      }
      const initialTarget = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              "[data-dialog-autofocus]",
            ),
          ).find(isFocusableVisible) ?? getFocusableElements(dialogRef.current)[0]
        : undefined;
      initialTarget?.focus();
      clearDocumentTextSelection();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      clearDocumentTextSelection();
      restoreFocusRef.current?.focus?.();
      clearDocumentTextSelection();
    };
  }, [focusContainerInitially]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (suspended) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose, suspended]);

  return { backdropPointerDownRef, dialogRef, requestClose };
}
