export type OtpEditResult = {
  value: string;
  focusIndex: number;
};

export function normalizeOtpLength(length: number): number {
  if (!Number.isFinite(length)) return 1;
  return Math.max(1, Math.floor(length));
}

export function normalizeOtpValue(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, normalizeOtpLength(length));
}

export function getOtpDigits(value: string, length: number): string[] {
  const normalizedLength = normalizeOtpLength(length);
  const normalizedValue = normalizeOtpValue(value, normalizedLength);

  return Array.from(
    { length: normalizedLength },
    (_, index) => normalizedValue[index] ?? "",
  );
}

/**
 * Keep focus inside the portion of the OTP that can currently be edited.
 *
 * The caller must pass its latest optimistic value, not a value captured by
 * the previous React render. Focus moves synchronously after a keystroke,
 * while a controlled parent can render the new value a little later.
 */
export function resolveOtpFocusIndex(
  value: string,
  requestedIndex: number,
  length: number,
): number {
  const normalizedLength = normalizeOtpLength(length);
  const normalizedValue = normalizeOtpValue(value, normalizedLength);
  const safeRequestedIndex = Number.isFinite(requestedIndex)
    ? Math.max(0, Math.floor(requestedIndex))
    : 0;

  return Math.min(safeRequestedIndex, normalizedValue.length, normalizedLength - 1);
}

function clampOtpIndex(index: number, length: number): number {
  const normalizedLength = normalizeOtpLength(length);
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), normalizedLength - 1);
}

export function setOtpDigit(
  value: string,
  index: number,
  nextDigit: string,
  length: number,
): OtpEditResult {
  const normalizedLength = normalizeOtpLength(length);
  const normalizedValue = normalizeOtpValue(value, normalizedLength);
  const digit = normalizeOtpValue(nextDigit, 1);
  const requestedIndex = clampOtpIndex(index, normalizedLength);
  const insertionIndex = Math.min(requestedIndex, normalizedValue.length);

  if (!digit) {
    return {
      value: normalizedValue,
      focusIndex: insertionIndex,
    };
  }

  const digits = normalizedValue.split("");
  if (insertionIndex < digits.length) digits[insertionIndex] = digit;
  else digits.push(digit);

  return {
    value: digits.join("").slice(0, normalizedLength),
    focusIndex: Math.min(insertionIndex + 1, normalizedLength - 1),
  };
}

export function removeOtpDigit(
  value: string,
  index: number,
  length: number,
): OtpEditResult {
  const normalizedLength = normalizeOtpLength(length);
  const normalizedValue = normalizeOtpValue(value, normalizedLength);
  const removalIndex = clampOtpIndex(index, normalizedLength);

  if (removalIndex >= normalizedValue.length) {
    return {
      value: normalizedValue,
      focusIndex: Math.min(normalizedValue.length, normalizedLength - 1),
    };
  }

  return {
    value:
      normalizedValue.slice(0, removalIndex) + normalizedValue.slice(removalIndex + 1),
    focusIndex: removalIndex,
  };
}

export function pasteOtpDigits(
  value: string,
  index: number,
  pastedValue: string,
  length: number,
): OtpEditResult {
  const normalizedLength = normalizeOtpLength(length);
  const normalizedValue = normalizeOtpValue(value, normalizedLength);
  const pastedDigits = normalizeOtpValue(pastedValue, normalizedLength);

  if (!pastedDigits) {
    return {
      value: normalizedValue,
      focusIndex: clampOtpIndex(index, normalizedLength),
    };
  }

  // A complete one-time code replaces the entire value regardless of which
  // visual cell received the browser autofill or paste event.
  if (pastedDigits.length === normalizedLength) {
    return {
      value: pastedDigits,
      focusIndex: normalizedLength - 1,
    };
  }

  const requestedIndex = clampOtpIndex(index, normalizedLength);
  const insertionIndex = Math.min(requestedIndex, normalizedValue.length);
  const digits = normalizedValue.split("");

  for (let offset = 0; offset < pastedDigits.length; offset += 1) {
    const destinationIndex = insertionIndex + offset;
    if (destinationIndex >= normalizedLength) break;
    digits[destinationIndex] = pastedDigits[offset];
  }

  return {
    value: digits.join("").slice(0, normalizedLength),
    focusIndex: Math.min(insertionIndex + pastedDigits.length - 1, normalizedLength - 1),
  };
}
