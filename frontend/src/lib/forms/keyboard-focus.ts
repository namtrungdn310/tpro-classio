import type { FocusEvent } from "react";

/**
 * Collapse the caret to the end of a pre-filled value when focus arrives from
 * the keyboard (Tab / Shift+Tab), so the browser's select-all does not paint
 * a blue highlight over the whole value. Mouse focus (`event.detail > 0`) and
 * drag selection are left untouched.
 */
export function collapseSelectionOnKeyboardFocus(
  event: FocusEvent<HTMLInputElement>,
) {
  const input = event.currentTarget;
  if (event.nativeEvent.detail === 0 && input.value.length > 0) {
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
