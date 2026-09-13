export const ACTION_CONTINUATION_WINDOW_MS = 1_000;
export const ACTION_CONTINUATION_DISTANCE_PX = 20;

export type PointerGestureSnapshot = {
  at: number;
  pointerType: string;
  x: number;
  y: number;
};

export function isActionContinuation(
  previous: PointerGestureSnapshot | null,
  next: PointerGestureSnapshot,
): boolean {
  if (!previous || previous.pointerType !== next.pointerType) {
    return false;
  }

  const elapsed = next.at - previous.at;
  if (elapsed < 0 || elapsed > ACTION_CONTINUATION_WINDOW_MS) {
    return false;
  }

  return (
    Math.hypot(next.x - previous.x, next.y - previous.y) <=
    ACTION_CONTINUATION_DISTANCE_PX
  );
}

export function clearDocumentTextSelection(ownerDocument: Document = document): void {
  ownerDocument.defaultView?.getSelection()?.removeAllRanges();
}

export function collapseNativeTextSelection(target: EventTarget | null): void {
  const control = findNativeTextControl(target);
  if (!control) {
    return;
  }

  try {
    const start = control.selectionStart;
    const end = control.selectionEnd;
    if (start === null || end === null || start === end) {
      return;
    }

    const caretPosition = control.selectionDirection === "backward" ? start : end;
    control.setSelectionRange(caretPosition, caretPosition, "none");
  } catch {
    // Some input types expose the selection API but do not support setting it.
  }
}

function findNativeTextControl(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const control = target.closest("input, textarea");
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
    ? control
    : null;
}
