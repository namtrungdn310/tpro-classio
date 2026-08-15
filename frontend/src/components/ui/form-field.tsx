"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  controlId?: string;
  error?: string;
  errorId?: string;
  hint?: ReactNode;
  label: string;
  labelId?: string;
  visuallyHiddenLabel?: boolean;
};

/**
 * Shared labelled form field: label above the control, optional helper hint,
 * and an error message announced with role="alert" right below the input.
 */
export function FormField({
  children,
  className,
  controlId,
  error,
  errorId: providedErrorId,
  hint,
  label,
  labelId,
  visuallyHiddenLabel = false,
}: FormFieldProps) {
  const errorId = providedErrorId ?? (controlId ? `${controlId}-error` : undefined);
  const labelClassName = cn(
    "form-label-text inline-block select-none text-gray-800",
    visuallyHiddenLabel && "sr-only",
  );
  return (
    <div
      className={cn("min-w-0 space-y-1.5", visuallyHiddenLabel && "space-y-0", className)}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }}
    >
      {controlId ? (
        <label htmlFor={controlId} className={labelClassName}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={labelClassName}>
          {label}
        </span>
      )}
      {children}
      {hint ? <p className="helper-text select-none text-gray-500">{hint}</p> : null}
      {error ? (
        <span id={errorId} role="alert" className="helper-text block text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
