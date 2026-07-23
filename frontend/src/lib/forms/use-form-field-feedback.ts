"use client";

import { useCallback, useState } from "react";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
  type FieldFeedbackState,
} from "@/lib/auth/field-feedback";

type FeedbackMap<FieldName extends string> = Record<FieldName, FieldFeedbackState>;

function createFeedbackMap<FieldName extends string>(
  fieldNames: readonly FieldName[],
): FeedbackMap<FieldName> {
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, { ...initialFieldFeedback }]),
  ) as FeedbackMap<FieldName>;
}

/**
 * Delays first-edit errors until blur, then keeps them live while correcting.
 * Clearing a field starts a fresh edit cycle; the next submit restores any
 * required-field error.
 */
export function useFormFieldFeedback<FieldName extends string>(
  fieldNames: readonly FieldName[],
) {
  const [feedback, setFeedback] = useState<FeedbackMap<FieldName>>(() =>
    createFeedbackMap(fieldNames),
  );

  const markInput = useCallback((fieldName: FieldName, value: unknown) => {
    setFeedback((current) => ({
      ...current,
      [fieldName]: fieldFeedbackAfterInput(current[fieldName], value),
    }));
  }, []);

  const markBlur = useCallback((fieldName: FieldName) => {
    setFeedback((current) => ({
      ...current,
      [fieldName]: fieldFeedbackAfterBlur(current[fieldName]),
    }));
  }, []);

  const markSubmitted = useCallback(() => {
    setFeedback((current) =>
      Object.fromEntries(
        Object.entries(current).map(([fieldName, state]) => [
          fieldName,
          fieldFeedbackAfterSubmit(state as FieldFeedbackState),
        ]),
      ) as FeedbackMap<FieldName>,
    );
  }, []);

  const resetFeedback = useCallback(() => {
    setFeedback(createFeedbackMap(fieldNames));
  }, [fieldNames]);

  const shouldShowError = useCallback(
    (fieldName: FieldName, isSubmitted: boolean) =>
      shouldShowFieldError(feedback[fieldName], isSubmitted),
    [feedback],
  );

  return {
    markBlur,
    markInput,
    markSubmitted,
    resetFeedback,
    shouldShowError,
  };
}
