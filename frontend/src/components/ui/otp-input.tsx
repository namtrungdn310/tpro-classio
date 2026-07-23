"use client";

import { forwardRef, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import {
  getOtpDigits,
  normalizeOtpLength,
  normalizeOtpValue,
  pasteOtpDigits,
  removeOtpDigit,
  resolveOtpFocusIndex,
  setOtpDigit,
} from "@/lib/forms/otp-input";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  className?: string;
  describedBy?: string;
  id?: string;
  invalid?: boolean;
  groupLabel?: string;
  layout?: "auth" | "compact";
};

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput({
  value,
  onChange,
  onBlur,
  disabled = false,
  autoFocus = false,
  length = 6,
  className = "",
  describedBy,
  id,
  invalid = false,
  groupLabel,
  layout = "compact",
}: OtpInputProps, forwardedRef) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const normalizedLength = normalizeOtpLength(length);
  const latestValueRef = useRef("");
  const normalizedValue = useMemo(
    () => normalizeOtpValue(value, normalizedLength),
    [normalizedLength, value],
  );
  const digits = useMemo(
    () => getOtpDigits(normalizedValue, normalizedLength),
    [normalizedLength, normalizedValue],
  );
  const resolvedGroupLabel = groupLabel ?? `Mã OTP gồm ${normalizedLength} chữ số`;
  const maximumCellWidthRem = layout === "auth" ? 3.125 : 2.75;
  const maximumWidthRem =
    normalizedLength * maximumCellWidthRem + Math.max(0, normalizedLength - 1) * 0.5;

  useEffect(() => {
    latestValueRef.current = normalizedValue;
  }, [normalizedValue]);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    inputRefs.current[0]?.focus();
  }, [autoFocus, disabled]);

  const commitChange = (nextValue: string) => {
    const normalizedNextValue = normalizeOtpValue(nextValue, normalizedLength);
    latestValueRef.current = normalizedNextValue;
    onChange(normalizedNextValue);
  };

  const focusIndex = (index: number, selectContent = true) => {
    const nextIndex = Math.min(Math.max(0, index), normalizedLength - 1);
    const nextInput = inputRefs.current[nextIndex];
    if (!nextInput) return;

    nextInput.focus();
    if (selectContent) {
      nextInput.select();
      return;
    }

    const caretPosition = nextInput.value.length;
    nextInput.setSelectionRange(caretPosition, caretPosition);
  };

  const handleInputChange = (index: number, rawValue: string) => {
    const latestValue = latestValueRef.current;
    const onlyDigits = rawValue.replace(/\D/g, "");

    if (!rawValue) {
      commitChange(removeOtpDigit(latestValue, index, normalizedLength).value);
      return;
    }

    if (!onlyDigits) return;

    if (onlyDigits.length > 1) {
      const result = pasteOtpDigits(latestValue, index, onlyDigits, normalizedLength);
      commitChange(result.value);
      focusIndex(result.focusIndex, false);
      return;
    }

    const result = setOtpDigit(latestValue, index, onlyDigits, normalizedLength);
    commitChange(result.value);
    // The last cell cannot advance any further. Collapsing the caret keeps the
    // completed digit visible without selecting it as if the user intended to
    // replace it.
    focusIndex(result.focusIndex, result.focusIndex !== index);
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    const latestValue = latestValueRef.current;
    const latestDigits = getOtpDigits(latestValue, normalizedLength);

    if (event.key === "Backspace") {
      event.preventDefault();
      const removalIndex = latestDigits[index] ? index : index - 1;
      if (removalIndex < 0) return;
      const result = removeOtpDigit(latestValue, removalIndex, normalizedLength);
      commitChange(result.value);
      focusIndex(result.focusIndex);
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      if (!latestDigits[index]) return;
      const result = removeOtpDigit(latestValue, index, normalizedLength);
      commitChange(result.value);
      focusIndex(result.focusIndex);
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusIndex(index - 1);
      return;
    }

    if (event.key === "ArrowRight" && index < normalizedLength - 1) {
      event.preventDefault();
      focusIndex(index + 1);
      return;
    }

    if (event.key === "Enter" && index < normalizedLength - 1) {
      event.preventDefault();
      focusIndex(latestDigits[index] ? index + 1 : Math.min(latestValue.length, normalizedLength - 1));
    }
  };

  const handlePaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const latestValue = latestValueRef.current;
    const result = pasteOtpDigits(
      latestValue,
      index,
      event.clipboardData.getData("text"),
      normalizedLength,
    );
    if (result.value === latestValue) return;
    commitChange(result.value);
    focusIndex(result.focusIndex, false);
  };

  return (
    <div
      role="group"
      aria-label={resolvedGroupLabel}
      aria-describedby={describedBy}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onBlur?.();
        }
      }}
      className={cn("grid w-full", className)}
      style={{
        gridTemplateColumns: `repeat(${normalizedLength}, minmax(0, 1fr))`,
        gap: "clamp(0.25rem, 2vw, 0.5rem)",
        maxWidth: `${maximumWidthRem}rem`,
      }}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          id={index === 0 ? id : undefined}
          ref={(node) => {
            inputRefs.current[index] = node;
            if (index === 0) {
              if (typeof forwardedRef === "function") forwardedRef(node);
              else if (forwardedRef) forwardedRef.current = node;
            }
          }}
          type="text"
          inputMode="numeric"
          autoComplete={
            index === 0
              ? savedInfoAutocomplete.oneTimeCode
              : savedInfoAutocomplete.disabled
          }
          enterKeyHint={index === normalizedLength - 1 ? "done" : "next"}
          maxLength={1}
          pattern="[0-9]*"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={digit}
          disabled={disabled}
          aria-label={`Chữ số OTP ${index + 1} trên ${normalizedLength}`}
          aria-invalid={index === 0 ? invalid || undefined : undefined}
          onChange={(event) => handleInputChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => {
            const resolvedFocusIndex = resolveOtpFocusIndex(
              latestValueRef.current,
              index,
              normalizedLength,
            );
            if (resolvedFocusIndex !== index) {
              focusIndex(resolvedFocusIndex);
              return;
            }
            event.currentTarget.select();
          }}
          onPaste={(event) => handlePaste(index, event)}
          className={cn(
            "otp-digit-text aspect-square w-full min-w-0 rounded-lg border border-gray-300 bg-white text-center text-gray-950 outline-none transition-[border-color,box-shadow,background-color] duration-150 enabled:hover:border-gray-400 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400",
            layout === "compact" && "max-w-11",
            invalid && "border-red-500 focus:border-red-500 focus:ring-red-100",
          )}
        />
      ))}
    </div>
  );
});

OtpInput.displayName = "OtpInput";
