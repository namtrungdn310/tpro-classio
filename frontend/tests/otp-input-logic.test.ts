import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getOtpDigits,
  normalizeOtpLength,
  normalizeOtpValue,
  pasteOtpDigits,
  removeOtpDigit,
  resolveOtpFocusIndex,
  setOtpDigit,
} from "../src/lib/forms/otp-input";

const otpComponentSource = readFileSync(
  new URL("../src/components/ui/otp-input.tsx", import.meta.url),
  "utf8",
);

test("OTP normalization keeps only the configured number of digits", () => {
  assert.equal(normalizeOtpLength(6.9), 6);
  assert.equal(normalizeOtpLength(0), 1);
  assert.equal(normalizeOtpValue("1 2a3-4567", 6), "123456");
  assert.deepEqual(getOtpDigits("12", 4), ["1", "2", "", ""]);
});

test("typing appends or replaces one OTP digit and advances focus", () => {
  assert.deepEqual(setOtpDigit("12", 2, "3", 6), {
    value: "123",
    focusIndex: 3,
  });
  assert.deepEqual(setOtpDigit("1234", 1, "9", 6), {
    value: "1934",
    focusIndex: 2,
  });
  assert.deepEqual(setOtpDigit("", 5, "7", 6), {
    value: "7",
    focusIndex: 1,
  });
});

test("OTP helpers discard non-numeric input without introducing content", () => {
  assert.deepEqual(setOtpDigit("12", 1, "a", 6), {
    value: "12",
    focusIndex: 1,
  });
  assert.deepEqual(pasteOtpDigits("12", 1, "not-a-code", 6), {
    value: "12",
    focusIndex: 1,
  });
});

test("Backspace and Delete remove a digit without leaving an invalid gap", () => {
  assert.deepEqual(removeOtpDigit("123456", 2, 6), {
    value: "12456",
    focusIndex: 2,
  });
  assert.deepEqual(removeOtpDigit("12", 5, 6), {
    value: "12",
    focusIndex: 2,
  });
});

test("a complete pasted OTP replaces the code from every visual cell", () => {
  assert.deepEqual(pasteOtpDigits("123456", 4, "98 76-54", 6), {
    value: "987654",
    focusIndex: 5,
  });
});

test("a partial paste starts at the selected visual cell", () => {
  assert.deepEqual(pasteOtpDigits("123456", 2, "90", 6), {
    value: "129056",
    focusIndex: 3,
  });
  assert.deepEqual(pasteOtpDigits("12", 5, "34", 6), {
    value: "1234",
    focusIndex: 3,
  });
});

test("OTP component keeps an immediate latest value while React render catches up", () => {
  assert.match(otpComponentSource, /const latestValueRef = useRef\(""\)/);
  assert.match(otpComponentSource, /latestValueRef\.current = normalizedNextValue/);
  assert.match(otpComponentSource, /const latestValue = latestValueRef\.current/);
  assert.doesNotMatch(otpComponentSource, /setOtpDigit\(normalizedValue, index/);
  assert.doesNotMatch(otpComponentSource, /pasteOtpDigits\(\s*normalizedValue,/);
});

test("focus advances from the optimistic OTP value before the controlled prop renders", () => {
  const firstKeyStroke = setOtpDigit("", 0, "1", 6);

  assert.equal(firstKeyStroke.value, "1");
  assert.equal(resolveOtpFocusIndex(firstKeyStroke.value, firstKeyStroke.focusIndex, 6), 1);
  assert.equal(resolveOtpFocusIndex("12", 5, 6), 2);
  assert.equal(resolveOtpFocusIndex("123456", 5, 6), 5);

  assert.match(
    otpComponentSource,
    /resolveOtpFocusIndex\(\s*latestValueRef\.current,\s*index,\s*normalizedLength,/,
  );
  assert.doesNotMatch(
    otpComponentSource,
    /if \(index > normalizedValue\.length\)/,
  );
});

test("completing the final OTP cell collapses the caret instead of selecting the digit", () => {
  const inputChangeHandler = otpComponentSource.slice(
    otpComponentSource.indexOf("const handleInputChange"),
    otpComponentSource.indexOf("const handleKeyDown"),
  );

  assert.match(
    inputChangeHandler,
    /focusIndex\(result\.focusIndex, result\.focusIndex !== index\)/,
  );
  assert.match(otpComponentSource, /nextInput\.setSelectionRange\(caretPosition, caretPosition\)/);
  assert.doesNotMatch(inputChangeHandler, /focusIndex\(result\.focusIndex\);/);
});

test("OTP layouts keep settings compact while auth screens fill the form width", () => {
  assert.match(otpComponentSource, /layout\?: "auth" \| "compact"/);
  assert.match(otpComponentSource, /layout = "compact"/);
  assert.match(otpComponentSource, /layout === "auth" \? 3\.125 : 2\.75/);
  assert.match(otpComponentSource, /layout === "compact" && "max-w-11"/);
  assert.doesNotMatch(otpComponentSource, /mx-auto grid/);
});
