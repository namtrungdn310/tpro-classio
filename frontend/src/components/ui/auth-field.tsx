import type { ReactNode } from "react";

type AuthFieldProps = {
  children: ReactNode;
  error?: string;
  id: string;
  label: string;
};

export function AuthField({ children, error, id, label }: AuthFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="form-label-text inline-block text-gray-700">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="form-message-text mt-1 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const authInputClassName =
  "auth-control form-input-text w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 outline-none transition focus:border-gray-500 focus:ring-1 focus:ring-gray-200";
export const authErrorInputClassName =
  "border-destructive focus:!border-destructive focus:!ring-destructive/15";
export const authSubmitClassName =
  "auth-primary-button";
