import assert from "node:assert/strict";
import test from "node:test";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
} from "../src/lib/auth/field-feedback";

test("empty focus and blur never exposes an error before submit", () => {
  const state = fieldFeedbackAfterBlur(initialFieldFeedback);
  assert.equal(shouldShowFieldError(state, false), false);
});

test("first edit waits for blur, then keeps the error while editing", () => {
  const editing = fieldFeedbackAfterInput(initialFieldFeedback, "ab");
  assert.equal(shouldShowFieldError(editing, false), false);

  const validated = fieldFeedbackAfterBlur(editing);
  assert.equal(shouldShowFieldError(validated, false), true);

  const editingAgain = fieldFeedbackAfterInput(validated, "abc");
  assert.equal(shouldShowFieldError(editingAgain, false), true);
});

test("clearing a value hides and resets its previous error", () => {
  const validated = fieldFeedbackAfterBlur(
    fieldFeedbackAfterInput(initialFieldFeedback, "invalid"),
  );
  const cleared = fieldFeedbackAfterInput(validated, "");

  assert.equal(shouldShowFieldError(cleared, false), false);
  assert.equal(shouldShowFieldError(cleared, true), false);

  const typingAgain = fieldFeedbackAfterInput(cleared, "new");
  assert.equal(shouldShowFieldError(typingAgain, true), false);
  assert.equal(shouldShowFieldError(fieldFeedbackAfterBlur(typingAgain), true), true);
});

test("a new submit attempt restores required-field errors", () => {
  const cleared = fieldFeedbackAfterInput(initialFieldFeedback, "");
  assert.equal(shouldShowFieldError(cleared, true), false);
  assert.equal(shouldShowFieldError(fieldFeedbackAfterSubmit(cleared), true), true);
});

test("null and empty grouped values start a fresh feedback cycle", () => {
  const validated = fieldFeedbackAfterBlur(
    fieldFeedbackAfterInput(initialFieldFeedback, ["value"]),
  );

  assert.equal(shouldShowFieldError(fieldFeedbackAfterInput(validated, []), true), false);
  assert.equal(shouldShowFieldError(fieldFeedbackAfterInput(validated, null), true), false);
});
