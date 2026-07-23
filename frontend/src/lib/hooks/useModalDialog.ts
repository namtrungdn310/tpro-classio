"use client";

import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useModalDialog({
  isBusy,
  onClose,
  suspended = false,
}: {
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
      onClose();
    }
  }, [isBusy, onClose, suspended]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const initialTarget =
        dialogRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initialTarget?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, []);

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

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute("inert") && element.offsetParent !== null);
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
