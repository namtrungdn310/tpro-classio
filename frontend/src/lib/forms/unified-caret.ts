export type CaretControlDescriptor = {
  contentEditable?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  tagName: string;
  type?: string | null;
};

const TEXT_INPUT_TYPES = new Set([
  "",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

/**
 * Only controls whose collapsed selection can be measured reliably use the
 * custom caret. Unsupported and read-only controls retain their native
 * browser behavior instead of risking a hidden or misplaced caret.
 */
export function supportsUnifiedCaret({
  contentEditable,
  disabled = false,
  readOnly = false,
  tagName,
  type,
}: CaretControlDescriptor) {
  if (disabled || readOnly) {
    return false;
  }

  const normalizedTagName = tagName.toLowerCase();
  if (normalizedTagName === "textarea") {
    return true;
  }

  if (normalizedTagName === "input") {
    return TEXT_INPUT_TYPES.has((type ?? "text").toLowerCase());
  }

  return contentEditable === "true";
}

/**
 * Aligning viewport coordinates to the physical-pixel grid prevents the same
 * one-pixel caret from being rasterized across one column in one field and
 * two columns in another at Windows display scaling or browser zoom.
 */
export function snapCaretCoordinate(value: number, devicePixelRatio: number) {
  const ratio = normalizeDevicePixelRatio(devicePixelRatio);
  return Math.round(value * ratio) / ratio;
}

/**
 * Return the nearest crisp physical-pixel length to the requested CSS length.
 * At non-integer DPR this may be slightly below or above one CSS pixel, but it
 * is always an integer number of physical pixels and therefore stays sharp.
 */
export function snapCaretLength(value: number, devicePixelRatio: number) {
  const ratio = normalizeDevicePixelRatio(devicePixelRatio);
  return Math.max(1, Math.round(Math.max(0, value) * ratio)) / ratio;
}

/**
 * Resolve the CSS length tokens used by the shared caret contract. Custom
 * properties keep their authored unit in getComputedStyle(), so treating a
 * value such as `1.25rem` as a raw number would incorrectly render it as
 * 1.25px.
 */
export function resolveCaretCssLength(
  value: string,
  {
    elementFontSize,
    rootFontSize,
  }: {
    elementFontSize: number;
    rootFontSize: number;
  },
) {
  const normalizedValue = value.trim().toLowerCase();
  const parsed = Number.parseFloat(normalizedValue);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  if (normalizedValue.endsWith("rem")) {
    return Number.isFinite(rootFontSize) && rootFontSize > 0
      ? parsed * rootFontSize
      : 0;
  }

  if (normalizedValue.endsWith("em")) {
    return Number.isFinite(elementFontSize) && elementFontSize > 0
      ? parsed * elementFontSize
      : 0;
  }

  if (
    normalizedValue.endsWith("px") ||
    /^-?(?:\d+|\d*\.\d+)$/.test(normalizedValue)
  ) {
    return parsed;
  }

  return 0;
}

export function resolveSingleLineTextOffset({
  contentWidth,
  direction,
  textAlign,
  textWidth,
}: {
  contentWidth: number;
  direction: string;
  textAlign: string;
  textWidth: number;
}) {
  const remainingWidth = Math.max(0, contentWidth - textWidth);
  const resolvedAlignment = resolveTextAlignment(textAlign, direction);

  if (resolvedAlignment === "center") {
    return remainingWidth / 2;
  }

  if (resolvedAlignment === "right") {
    return remainingWidth;
  }

  return 0;
}

function resolveTextAlignment(textAlign: string, direction: string) {
  const normalizedAlignment = textAlign.toLowerCase();
  const isRightToLeft = direction.toLowerCase() === "rtl";

  if (normalizedAlignment === "center") {
    return "center";
  }

  if (
    normalizedAlignment === "right" ||
    (normalizedAlignment === "end" && !isRightToLeft) ||
    (normalizedAlignment === "start" && isRightToLeft)
  ) {
    return "right";
  }

  return "left";
}

function normalizeDevicePixelRatio(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
