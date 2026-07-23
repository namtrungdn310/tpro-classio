export type FieldFeedbackState = {
  clearedAfterSubmit: boolean;
  edited: boolean;
  validated: boolean;
};

export const initialFieldFeedback: FieldFeedbackState = {
  clearedAfterSubmit: false,
  edited: false,
  validated: false,
};

export function fieldFeedbackAfterInput(
  current: FieldFeedbackState,
  value: unknown,
): FieldFeedbackState {
  if (isEmptyFieldFeedbackValue(value)) {
    return {
      clearedAfterSubmit: true,
      edited: false,
      validated: false,
    };
  }

  return {
    ...current,
    edited: true,
  };
}

export function isEmptyFieldFeedbackValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || Array.isArray(value)) return value.length === 0;
  return false;
}

export function fieldFeedbackAfterBlur(current: FieldFeedbackState): FieldFeedbackState {
  if (!current.edited) return current;

  return {
    ...current,
    clearedAfterSubmit: false,
    validated: true,
  };
}

export function fieldFeedbackAfterSubmit(current: FieldFeedbackState): FieldFeedbackState {
  return {
    ...current,
    clearedAfterSubmit: false,
  };
}

export function shouldShowFieldError(
  current: FieldFeedbackState,
  isSubmitted: boolean,
): boolean {
  return (
    (isSubmitted && !current.clearedAfterSubmit) ||
    (current.edited && current.validated)
  );
}
