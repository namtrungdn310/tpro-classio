import type { KeyboardEvent } from "react";

export function moveFocusOnValidArrowDown(
  event: KeyboardEvent<HTMLInputElement>,
  isValid: boolean,
  focusNext: () => void,
) {
  if (
    event.key !== "ArrowDown" ||
    !isValid ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing
  ) {
    return;
  }

  event.preventDefault();
  focusNext();
}
