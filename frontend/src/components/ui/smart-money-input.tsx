"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  formatMoneyInput,
  getFormattedMoneyCaretPosition,
  parsePlainMoneyInput,
  parseSmartMoneyInput,
} from "@/lib/forms/money-input";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { collapseSelectionOnKeyboardFocus } from "@/lib/forms/keyboard-focus";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { cn } from "@/lib/utils";

type SmartMoneyInputProps = {
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  className?: string;
  dataCol?: number;
  dataRow?: number;
  dataVerticalArrowScope?: string;
  disabled?: boolean;
  id?: string;
  isContentHidden?: boolean;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  onDraftChange?: (rawValue: string, isComplete: boolean) => void;
  placeholder?: string;
  required?: boolean;
  trailingControl?: React.ReactNode;
  value: number | null;
};

export function SmartMoneyInput({
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid = false,
  className,
  dataCol,
  dataRow,
  dataVerticalArrowScope,
  disabled = false,
  id,
  isContentHidden = false,
  onChange,
  onBlur,
  onDraftChange,
  placeholder,
  required = false,
  trailingControl,
  value,
}: SmartMoneyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [expandedValue, setExpandedValue] = useState<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaretPositionRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caretPosition = pendingCaretPositionRef.current;
    const input = inputRef.current;
    if (caretPosition === null || !input) {
      return;
    }

    pendingCaretPositionRef.current = null;
    if (document.activeElement === input) {
      input.setSelectionRange(caretPosition, caretPosition);
    }
  }, [inputValue]);

  useEffect(() => {
    if (isFocused) {
      return;
    }

    if (value === null) {
      setInputValue("");
      setPreviewText(null);
      setExpandedValue(null);
      return;
    }

    if (value !== expandedValue) {
      setInputValue(formatMoneyInput(value));
      setPreviewText(null);
      setExpandedValue(null);
    }
  }, [expandedValue, isFocused, value]);

  function commitExpandedValue() {
    if (expandedValue === null) {
      return false;
    }

    setInputValue(formatMoneyInput(expandedValue));
    if (expandedValue !== value) {
      onChange(expandedValue);
    }
    setPreviewText(null);
    setExpandedValue(null);
    return true;
  }

  function applyFormattedPlainValue(
    plainValue: number | null,
    rawText: string,
    rawCaretPosition: number,
  ) {
    const formattedValue = formatMoneyInput(plainValue);
    pendingCaretPositionRef.current = getFormattedMoneyCaretPosition(
      rawText,
      rawCaretPosition,
      formattedValue,
    );
    setInputValue(formattedValue);
    setPreviewText(null);
    setExpandedValue(null);
    onChange(plainValue);
  }

  return (
    <div className="relative flex w-full items-center">
      <input
        ref={inputRef}
        id={id}
        type="text"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={inputValue}
        onChange={(event) => {
          const rawDisplayText = event.currentTarget.value;
          const rawCaretPosition =
            event.currentTarget.selectionStart ?? rawDisplayText.length;
          const rawText = rawDisplayText.toLowerCase().replace(/\s+/g, "");
          if (rawText.includes(",") || /[^0-9.trmk]/i.test(rawText)) {
            return;
          }

          if (rawText === "") {
            setInputValue("");
            setPreviewText(null);
            setExpandedValue(null);
            onChange(null);
            onDraftChange?.("", true);
            return;
          }

          const nativeInputEvent = event.nativeEvent as InputEvent;
          const wasFormattedPlainValue = /^\d{1,3}(?:\.\d{3})+$/.test(inputValue);
          const isPlainDigitEdit =
            nativeInputEvent.inputType.startsWith("delete") ||
            /^\d+$/.test(nativeInputEvent.data ?? "");
          if (wasFormattedPlainValue && isPlainDigitEdit) {
            const plainValue = Number(rawText.replace(/\./g, ""));
            applyFormattedPlainValue(
              plainValue,
              rawDisplayText,
              rawCaretPosition,
            );
            onDraftChange?.(rawText, true);
            return;
          }

          if (/^\d+(?:\.\d{3})*$/.test(rawText)) {
            const plainValue = parsePlainMoneyInput(rawText);
            applyFormattedPlainValue(
              plainValue,
              rawDisplayText,
              rawCaretPosition,
            );
            onDraftChange?.(rawText, true);
            return;
          }

          const isProgressiveSmartMoneyInput =
            /^\d+\.\d{0,3}(?:t(?:r)?|m|k)?$/.test(rawText) ||
            /^\d+(?:t(?:r(?:\d{0,3})?)?|m(?:\d{0,3})?|k(?:\d{0,3})?)?$/.test(rawText);
          if (!isProgressiveSmartMoneyInput) {
            return;
          }

          setInputValue(rawText);

          const parsed = parseSmartMoneyInput(rawText);
          if (parsed.value !== null && parsed.preview !== null) {
            setPreviewText(parsed.preview);
            setExpandedValue(parsed.value);
            onChange(parsed.value);
            onDraftChange?.(rawText, true);
            return;
          }

          setPreviewText(null);
          setExpandedValue(null);
          onChange(null);
          onDraftChange?.(rawText, false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && expandedValue !== null) {
            event.preventDefault();
            commitExpandedValue();
          }
        }}
        onFocus={(event) => {
          setIsFocused(true);
          collapseSelectionOnKeyboardFocus(event);
        }}
        onBlur={() => {
          if (!commitExpandedValue()) {
            const plainValue = parsePlainMoneyInput(inputValue);
            setInputValue(formatMoneyInput(plainValue));
            if (plainValue !== value) {
              onChange(plainValue);
            }
            onDraftChange?.(inputValue, inputValue.length === 0 || plainValue !== null);
          }
          setIsFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        required={required}
        autoComplete={savedInfoAutocomplete.disabled}
        className={cn(formTextControlClassName, className)}
        style={{
          paddingRight: previewText
            ? trailingControl
              ? "8.25rem"
              : "6.25rem"
            : trailingControl
              ? "2.5rem"
              : undefined,
        }}
        data-row={dataRow}
        data-col={dataCol}
        data-vertical-arrow-scope={dataVerticalArrowScope}
        data-private-hidden={isContentHidden}
      />
      {previewText ? (
        <span
          className="form-input-text pointer-events-none absolute top-1/2 -translate-y-1/2 select-none font-normal text-gray-400"
          style={{ right: trailingControl ? "2.5rem" : "0.75rem" }}
        >
          {previewText}
        </span>
      ) : null}
      {trailingControl ? (
        <div className="absolute inset-y-0 right-1 z-20 flex items-center">{trailingControl}</div>
      ) : null}
    </div>
  );
}
