"use client";

import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "type">;

/**
 * Password field that preserves the browser's native text-editing behavior.
 * Native inputs provide accurate pointer placement, selection, IME and
 * accessibility semantics; the button only changes visibility.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { autoComplete = savedInfoAutocomplete.disabled, className, disabled, ...props },
  ref,
) {
  const [isVisible, setIsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectionRef = useRef<{
    direction: "backward" | "forward" | "none";
    end: number;
    start: number;
  } | null>(null);

  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    const input = inputRef.current;
    if (!selection || !input) return;

    const frameId = window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.setSelectionRange(selection.start, selection.end, selection.direction);
      pendingSelectionRef.current = null;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isVisible]);

  function setInputRef(element: HTMLInputElement | null) {
    inputRef.current = element;

    if (typeof ref === "function") {
      ref(element);
      return;
    }

    if (ref) {
      ref.current = element;
    }
  }

  function rememberSelection() {
    const input = inputRef.current;
    if (!input) return;

    pendingSelectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
      direction: input.selectionDirection ?? "none",
    };
  }

  function toggleVisibility() {
    setIsVisible((current) => !current);
  }

  return (
    <div className="relative">
      <input
        {...props}
        autoComplete={autoComplete}
        disabled={disabled}
        ref={setInputRef}
        type={isVisible ? "text" : "password"}
        className={cn(className, !isVisible && "password-input-native", "pr-10")}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={isVisible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 transition hover:text-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
        onPointerDown={rememberSelection}
        onMouseDown={(event) => {
          rememberSelection();
          event.preventDefault();
        }}
        onClick={toggleVisibility}
      >
        {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

PasswordInput.displayName = "PasswordInput";
