import type { KeyboardEvent } from "react";

type FieldCoordinate = {
  column: number;
  row: number;
};

type NavigationDirection = -1 | 1;
type EditableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const EDITABLE_FIELD_SELECTOR =
  'input[data-row]:not([type="hidden"]):not([disabled]), textarea[data-row]:not([disabled]), select[data-row]:not([disabled])';
const ACTIVE_CARET_ATTRIBUTE = "data-unified-caret-active";

export function moveFocusByVerticalArrow(
  event: KeyboardEvent<HTMLElement>,
): boolean {
  const direction = getDirection(event.key);
  if (
    direction === null ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing
  ) {
    return false;
  }

  const current = getEditableField(event.target);
  if (
    !current ||
    current.getAttribute(ACTIVE_CARET_ATTRIBUTE) !== "true" ||
    !event.currentTarget.contains(current)
  ) {
    return false;
  }

  const currentCoordinate = getFieldCoordinate(current);
  if (!currentCoordinate) {
    return false;
  }

  const verticalScope =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.dataset.verticalArrowScope
      : undefined;
  if (verticalScope && current.dataset.verticalArrowScope !== verticalScope) {
    return false;
  }
  const fields = Array.from(
    event.currentTarget.querySelectorAll<EditableField>(EDITABLE_FIELD_SELECTOR),
  ).filter(
    (field) =>
      !verticalScope || field.dataset.verticalArrowScope === verticalScope,
  );
  const targetCoordinate = findVerticalNavigationTarget(
    fields.flatMap((field) => {
      const coordinate = getFieldCoordinate(field);
      return coordinate ? [coordinate] : [];
    }),
    currentCoordinate,
    direction,
  );
  if (!targetCoordinate) {
    return false;
  }

  const target = fields.find((field) => {
    const coordinate = getFieldCoordinate(field);
    return (
      coordinate?.row === targetCoordinate.row &&
      coordinate.column === targetCoordinate.column
    );
  });
  if (!target) {
    return false;
  }

  event.preventDefault();
  target.focus();
  placeCaretAtEnd(target);
  return true;
}

export function moveFocusByFormArrow(
  event: KeyboardEvent<HTMLElement>,
): boolean {
  if (moveFocusByVerticalArrow(event)) {
    return true;
  }

  const direction = getHorizontalDirection(event.key);
  if (
    direction === null ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing
  ) {
    return false;
  }

  const current = getEditableField(event.target);
  if (
    !current ||
    current.getAttribute(ACTIVE_CARET_ATTRIBUTE) !== "true" ||
    !event.currentTarget.contains(current) ||
    !isAtHorizontalBoundary(current, direction)
  ) {
    return false;
  }

  const currentCoordinate = getFieldCoordinate(current);
  if (!currentCoordinate) {
    return false;
  }

  const fields = Array.from(
    event.currentTarget.querySelectorAll<EditableField>(EDITABLE_FIELD_SELECTOR),
  );
  const targetCoordinate = findHorizontalNavigationTarget(
    fields.flatMap((field) => {
      const coordinate = getFieldCoordinate(field);
      return coordinate ? [coordinate] : [];
    }),
    currentCoordinate,
    direction,
  );
  if (!targetCoordinate) {
    return false;
  }

  const target = fields.find((field) => {
    const coordinate = getFieldCoordinate(field);
    return (
      coordinate?.row === targetCoordinate.row &&
      coordinate.column === targetCoordinate.column
    );
  });
  if (!target) {
    return false;
  }

  event.preventDefault();
  target.focus();
  placeCaret(target, direction < 0 ? target.value.length : 0);
  return true;
}

export function findVerticalNavigationTarget(
  fields: readonly FieldCoordinate[],
  current: FieldCoordinate,
  direction: NavigationDirection,
): FieldCoordinate | null {
  const rows = [...new Set(fields.map((field) => field.row))].sort(
    (left, right) => left - right,
  );
  const currentRowIndex = rows.indexOf(current.row);
  const targetRow = rows[currentRowIndex + direction];
  if (currentRowIndex < 0 || targetRow === undefined) {
    return null;
  }

  const candidates = fields
    .filter((field) => field.row === targetRow)
    .sort(
      (left, right) =>
        Math.abs(left.column - current.column) -
          Math.abs(right.column - current.column) ||
        left.column - right.column,
    );
  return candidates[0] ?? null;
}

export function findHorizontalNavigationTarget(
  fields: readonly FieldCoordinate[],
  current: FieldCoordinate,
  direction: NavigationDirection,
): FieldCoordinate | null {
  const candidates = fields
    .filter(
      (field) =>
        field.row === current.row &&
        (direction < 0
          ? field.column < current.column
          : field.column > current.column),
    )
    .sort((left, right) =>
      direction < 0
        ? right.column - left.column
        : left.column - right.column,
    );
  return candidates[0] ?? null;
}

function getDirection(key: string): NavigationDirection | null {
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return null;
}

function getHorizontalDirection(key: string): NavigationDirection | null {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return null;
}

function getEditableField(
  target: EventTarget | null,
): EditableField | null {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target;
  }
  return null;
}

function getFieldCoordinate(
  field: EditableField,
): FieldCoordinate | null {
  const row = Number(field.dataset.row);
  const column = Number(field.dataset.col ?? 0);
  if (!Number.isInteger(row) || !Number.isInteger(column)) {
    return null;
  }
  return { row, column };
}

function isAtHorizontalBoundary(
  field: EditableField,
  direction: NavigationDirection,
): boolean {
  if (field instanceof HTMLSelectElement) return false;
  return isHorizontalNavigationBoundary(
    field.value.length,
    field.selectionStart,
    field.selectionEnd,
    direction,
  );
}

export function isHorizontalNavigationBoundary(
  valueLength: number,
  selectionStart: number | null,
  selectionEnd: number | null,
  direction: NavigationDirection,
): boolean {
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart !== selectionEnd
  ) {
    return false;
  }
  return direction < 0
    ? selectionStart === 0
    : selectionEnd === valueLength;
}

function placeCaretAtEnd(field: EditableField): void {
  if (field instanceof HTMLSelectElement) return;
  placeCaret(field, field.value.length);
}

function placeCaret(field: EditableField, position: number): void {
  if (field instanceof HTMLSelectElement) return;
  field.setSelectionRange(position, position);
}
