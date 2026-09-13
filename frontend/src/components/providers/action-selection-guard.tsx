"use client";

import { useEffect } from "react";
import {
  clearDocumentTextSelection,
  collapseNativeTextSelection,
  isActionContinuation,
  type PointerGestureSnapshot,
} from "@/lib/ui/action-selection";

const ACTION_SELECTOR =
  "button, a[href], summary, [role='button'], [role='link'], [data-action-control='true'], input[type='button'], input[type='submit'], input[type='reset']";
const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";
const SELECTION_PRESERVING_SELECTOR =
  "[data-selection-policy='preserve'], [data-fee-template-editor-control]";

function findActionTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(ACTION_SELECTOR) : null;
}

function isActionTarget(target: EventTarget | null): boolean {
  return findActionTarget(target) !== null;
}

function isSelectionPreservingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(SELECTION_PRESERVING_SELECTOR))
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(EDITABLE_SELECTOR));
}

function toPointerSnapshot(event: PointerEvent): PointerGestureSnapshot {
  return {
    at: performance.now(),
    pointerType: event.pointerType || "mouse",
    x: event.clientX,
    y: event.clientY,
  };
}

function toMouseSnapshot(
  event: MouseEvent,
  pointerType: string,
): PointerGestureSnapshot {
  return {
    at: performance.now(),
    pointerType,
    x: event.clientX,
    y: event.clientY,
  };
}

/**
 * Keeps native text selection out of interactive controls without disabling
 * selection in tables, editors, or regular form fields.
 */
export function ActionSelectionGuard() {
  useEffect(() => {
    let actionAnchor: PointerGestureSnapshot | null = null;
    let anchorAction: Element | null = null;
    let activeActionPointerId: number | null = null;
    let suppressedPointerId: number | null = null;
    let suppressedGesture: PointerGestureSnapshot | null = null;
    let suppressNextClick = false;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;

    const cancelScheduledClear = () => {
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
        firstFrame = null;
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
        secondFrame = null;
      }
    };

    const clearSelection = (target: EventTarget | null) => {
      clearDocumentTextSelection();
      collapseNativeTextSelection(target);
    };

    const scheduleClear = (target: EventTarget | null) => {
      clearSelection(target);
      cancelScheduledClear();
      firstFrame = window.requestAnimationFrame(() => {
        clearSelection(target);
        firstFrame = null;
        secondFrame = window.requestAnimationFrame(() => {
          clearSelection(target);
          secondFrame = null;
        });
      });
    };

    const resetGesture = () => {
      actionAnchor = null;
      anchorAction = null;
      activeActionPointerId = null;
      suppressedPointerId = null;
      suppressedGesture = null;
      suppressNextClick = false;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (isSelectionPreservingTarget(event.target)) {
        resetGesture();
        cancelScheduledClear();
        return;
      }

      const snapshot = toPointerSnapshot(event);
      const currentAction = findActionTarget(event.target);
      const continuedAtReplacedTarget =
        isActionContinuation(actionAnchor, snapshot) &&
        currentAction !== anchorAction;
      if (continuedAtReplacedTarget) {
        suppressedPointerId = event.pointerId;
        suppressedGesture = snapshot;
        suppressNextClick = true;
        actionAnchor = snapshot;
        if (!isEditableTarget(event.target)) {
          event.preventDefault();
        }
        scheduleClear(event.target);
        return;
      }

      if (currentAction) {
        actionAnchor = snapshot;
        anchorAction = currentAction;
        activeActionPointerId = event.pointerId;
        suppressedPointerId = null;
        suppressedGesture = null;
        suppressNextClick = false;
        scheduleClear(event.target);
        return;
      }

      resetGesture();
    };

    const handleSelectStart = (event: Event) => {
      if (isSelectionPreservingTarget(event.target)) {
        return;
      }
      if (
        activeActionPointerId === null &&
        suppressedPointerId === null &&
        !isActionTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      scheduleClear(event.target);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const pointerType = actionAnchor?.pointerType ?? "mouse";
      const isContinuation = isActionContinuation(
        actionAnchor,
        toMouseSnapshot(event, pointerType),
      );
      if (!isActionTarget(event.target) && !isContinuation) {
        return;
      }
      event.preventDefault();
      scheduleClear(event.target);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId === activeActionPointerId) {
        activeActionPointerId = null;
        scheduleClear(event.target);
        return;
      }

      if (event.pointerId === suppressedPointerId) {
        suppressedPointerId = null;
        scheduleClear(event.target);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (isSelectionPreservingTarget(event.target)) {
        resetGesture();
        cancelScheduledClear();
        return;
      }

      if (suppressNextClick && suppressedGesture) {
        const clickSnapshot = toMouseSnapshot(
          event,
          actionAnchor?.pointerType ?? suppressedGesture.pointerType,
        );
        if (isActionContinuation(suppressedGesture, clickSnapshot)) {
          event.preventDefault();
          event.stopPropagation();
          actionAnchor = clickSnapshot;
          suppressNextClick = false;
          suppressedGesture = null;
          scheduleClear(event.target);
          return;
        }
      }

      if (isActionTarget(event.target)) {
        scheduleClear(event.target);
      }
    };

    const handleWindowBlur = () => {
      resetGesture();
      cancelScheduledClear();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("selectstart", handleSelectStart, true);
    document.addEventListener("dblclick", handleDoubleClick, true);
    document.addEventListener("pointerup", handlePointerEnd, true);
    document.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      cancelScheduledClear();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("selectstart", handleSelectStart, true);
      document.removeEventListener("dblclick", handleDoubleClick, true);
      document.removeEventListener("pointerup", handlePointerEnd, true);
      document.removeEventListener("pointercancel", handlePointerEnd, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  return null;
}
