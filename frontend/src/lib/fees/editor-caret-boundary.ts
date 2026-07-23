/**
 * Gives the browser an editable text position beside an atomic
 * `contenteditable=false` token. The marker is a DOM-only implementation
 * detail and must never be persisted in a Zalo message template.
 */
export const FEE_TEMPLATE_CARET_BOUNDARY = "\u200B";

export function stripFeeTemplateCaretBoundaries(value: string): string {
  return value.replaceAll(FEE_TEMPLATE_CARET_BOUNDARY, "");
}
