"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { collapseSelectionOnKeyboardFocus } from "@/lib/forms/keyboard-focus";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { cn } from "@/lib/utils";

const DATE_GUIDE = "dd/mm/yyyy";

type ManualDateInputProps = {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  className?: string;
  dataCol?: number;
  dataRow?: number;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  isContentHidden?: boolean;
  privacyToggle?: ReactNode;
};

/**
 * Canonical dd/mm/yyyy single input control with flexible caret navigation.
 * Slash-aware formatting ensures editing Day, Month, or Year never shifts adjacent digits.
 */
export function ManualDateInput({
  value,
  onChange,
  onBlur,
  ariaLabel,
  ariaDescribedBy,
  className,
  dataCol,
  dataRow,
  disabled = false,
  error = false,
  id,
  isContentHidden = false,
  privacyToggle,
}: ManualDateInputProps) {
  const initialValue = value ?? null;
  const [inputValue, setInputValue] = useState(() => isoToDisplayDate(initialValue));
  const lastSyncedValue = useRef<string | null>(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const normalizedValue = value ?? null;
    if (normalizedValue === lastSyncedValue.current) return;
    lastSyncedValue.current = normalizedValue;
    setInputValue(isoToDisplayDate(normalizedValue));
  }, [value]);

  function updateParent(displayValue: string) {
    const isoValue = displayToIsoDate(displayValue);
    const nextValue = isoValue ?? (displayValue.trim() ? displayValue : null);
    lastSyncedValue.current = nextValue;
    onChange(nextValue);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const raw = input.value;
    const cursor = input.selectionStart ?? raw.length;

    let formatted = formatManualDateInput(raw);
    let nextCursor = cursor;

    // Auto-advance slash when typing 2nd digit of day or month progressively
    if (raw.length === 2 && !raw.includes("/") && formatted.length === 2) {
      formatted = `${formatted}/`;
      nextCursor = 3;
    } else if (
      raw.length === 5 &&
      raw.indexOf("/") === 2 &&
      raw.lastIndexOf("/") === 2
    ) {
      formatted = `${formatted}/`;
      nextCursor = 6;
    } else if (cursor === 2 && formatted.length >= 3 && formatted[2] === "/") {
      // If typing ended right before a slash, place caret after the slash
      nextCursor = 3;
    } else if (cursor === 5 && formatted.length >= 6 && formatted[5] === "/") {
      nextCursor = 6;
    }

    setInputValue(formatted);
    updateParent(formatted);

    // Flexible caret restoration so editing in the middle never snaps to the end
    window.requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;

    // Flexible caret navigation across slashes with ArrowLeft / ArrowRight
    if (event.key === "ArrowLeft" && start !== null && start === end) {
      if (start === 3 || start === 6) {
        event.preventDefault();
        input.setSelectionRange(start - 1, start - 1);
        return;
      }
    }

    if (event.key === "ArrowRight" && start !== null && start === end) {
      if (start === 2 || start === 5) {
        event.preventDefault();
        input.setSelectionRange(start + 1, start + 1);
        return;
      }
    }

    // Slash key advances focus to next segment
    if (event.key === "/") {
      if (start !== null && start === end) {
        if (start < 3) {
          event.preventDefault();
          const parts = inputValue.split("/");
          if (parts[0] && parts[0].length === 1) {
            const next = `0${parts[0]}/${parts.slice(1).join("/")}`;
            setInputValue(next);
            updateParent(next);
            window.requestAnimationFrame(() => {
              input.setSelectionRange(3, 3);
            });
          } else {
            input.setSelectionRange(3, 3);
          }
          return;
        }
        if (start >= 3 && start < 6) {
          event.preventDefault();
          const parts = inputValue.split("/");
          if (parts[1] && parts[1].length === 1) {
            const next = `${parts[0]}/0${parts[1]}/${parts.slice(2).join("/")}`;
            setInputValue(next);
            updateParent(next);
            window.requestAnimationFrame(() => {
              input.setSelectionRange(6, 6);
            });
          } else {
            input.setSelectionRange(6, 6);
          }
          return;
        }
      }
    }

    // Backspace handling
    if (event.key === "Backspace") {
      if (start === null || start !== end || start === 0) return;

      // If caret is immediately after a slash, delete the digit before the slash cleanly
      if (input.value[start - 1] === "/") {
        event.preventDefault();
        const beforeSlash = input.value.slice(0, start - 2);
        const afterSlash = input.value.slice(start);
        const nextRaw = `${beforeSlash}/${afterSlash}`;
        const formatted = formatManualDateInput(nextRaw);
        setInputValue(formatted);
        updateParent(formatted);
        const nextPos = Math.max(0, start - 2);
        window.requestAnimationFrame(() => {
          input.setSelectionRange(nextPos, nextPos);
        });
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text").trim();
    // ISO format: YYYY-MM-DD
    const isoMatch = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text);
    if (isoMatch) {
      event.preventDefault();
      const [, y, m, d] = isoMatch;
      const formatted = `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
      setInputValue(formatted);
      updateParent(formatted);
      window.requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(formatted.length, formatted.length);
      });
      return;
    }
    // Display format: DD/MM/YYYY
    const dMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (dMatch) {
      event.preventDefault();
      const [, d, m, y] = dMatch;
      const formatted = `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
      setInputValue(formatted);
      updateParent(formatted);
      window.requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(formatted.length, formatted.length);
      });
      return;
    }
  }

  return (
    <div
      className={cn(
        formTextControlClassName,
        "relative flex items-center overflow-hidden",
        error && formTextControlErrorClassName,
        className,
      )}
      style={{ paddingRight: privacyToggle ? "2.5rem" : undefined }}
    >
      <div
        aria-hidden="true"
        className={cn(
          "form-input-text pointer-events-none absolute left-3 flex items-center whitespace-pre text-left",
          privacyToggle ? "right-10" : "right-3",
        )}
      >
        <span className="select-none text-transparent">{inputValue}</span>
        <span className="select-none font-normal text-gray-300">
          {DATE_GUIDE.slice(inputValue.length)}
        </span>
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={10}
        value={inputValue}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        aria-describedby={ariaDescribedBy}
        autoComplete={savedInfoAutocomplete.disabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={collapseSelectionOnKeyboardFocus}
        onBlur={onBlur}
        data-row={dataRow}
        data-col={dataCol}
        data-private-hidden={isContentHidden}
        className="form-input-text relative z-10 h-full w-full select-text bg-transparent text-left text-gray-900 outline-none caret-gray-900 disabled:cursor-not-allowed"
      />
      {privacyToggle ? (
        <div className="absolute inset-y-0 right-1 z-20 flex items-center">
          {privacyToggle}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Slash-aware date formatter.
 * Preserves slashes so editing Day, Month, or Year does not shift digits across boundaries.
 */
export function formatManualDateInput(raw: string) {
  if (raw.includes("/")) {
    const parts = raw.split("/");
    const d = parts[0]?.replace(/\D/g, "").slice(0, 2) ?? "";
    const m = parts[1]?.replace(/\D/g, "").slice(0, 2) ?? "";
    const y = parts[2]?.replace(/\D/g, "").slice(0, 4) ?? "";

    // Deleting every digit from a formatted value must also remove the
    // separators; otherwise the controlled field gets stuck at "//".
    if (!d && !m && !y) return "";

    if (parts.length === 1) return d;
    if (parts.length === 2) return `${d}/${m}`;
    return `${d}/${m}/${y}`;
  }
  const clean = raw.replace(/\D/g, "").slice(0, 8);
  return [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 8)]
    .filter(Boolean)
    .join("/");
}

export function displayToIsoDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const isoValue = `${year}-${month}-${day}`;
  return isValidIsoDate(isoValue) ? isoValue : null;
}

export function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

export function comparableManualDate(
  draftValue: string | null | undefined,
  persistedValue: string | null | undefined,
) {
  return draftValue && isValidIsoDate(draftValue)
    ? draftValue
    : persistedValue ?? null;
}

function isoToDisplayDate(value: string | null) {
  if (!value || !isValidIsoDate(value)) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
