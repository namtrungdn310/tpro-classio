export type ParsedSmartMoney = {
  preview: string | null;
  value: number | null;
};

export function parsePlainMoneyInput(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{3})*$/.test(normalized)) {
    return null;
  }

  return Number(normalized.replace(/\./g, ""));
}

export function formatMoneyInput(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }

  return value.toLocaleString("vi-VN");
}

export function getFormattedMoneyCaretPosition(
  rawText: string,
  rawCaretPosition: number,
  formattedText: string,
) {
  const safeRawCaretPosition = Math.max(
    0,
    Math.min(rawCaretPosition, rawText.length),
  );
  const digitsBeforeCaret = (
    rawText.slice(0, safeRawCaretPosition).match(/\d/g) ?? []
  ).length;

  if (digitsBeforeCaret === 0) {
    return 0;
  }

  let seenDigits = 0;
  for (let index = 0; index < formattedText.length; index += 1) {
    if (/\d/.test(formattedText[index])) {
      seenDigits += 1;
      if (seenDigits === digitsBeforeCaret) {
        return index + 1;
      }
    }
  }

  return formattedText.length;
}

export function parseSmartMoneyInput(text: string): ParsedSmartMoney {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes(",") || normalized.includes("k")) {
    return { value: null, preview: null };
  }

  const splitMillionMatch = normalized.match(/^(\d+)tr(\d{1,3})$/);
  if (splitMillionMatch) {
    const fractionalThousands = Number(splitMillionMatch[2].padEnd(3, "0")) * 1_000;
    const value =
      Number(splitMillionMatch[1]) * 1_000_000 +
      fractionalThousands;
    return { value, preview: formatMoneyInput(value) };
  }

  const decimalMillionMatch = normalized.match(/^(\d+)(?:\.(\d{1,3}))?tr$/);
  if (decimalMillionMatch) {
    const wholeMillions = Number(decimalMillionMatch[1]) * 1_000_000;
    const fractionalThousands = decimalMillionMatch[2]
      ? Number(decimalMillionMatch[2].padEnd(3, "0")) * 1_000
      : 0;
    const value = wholeMillions + fractionalThousands;
    return { value, preview: formatMoneyInput(value) };
  }

  return { value: null, preview: null };
}
