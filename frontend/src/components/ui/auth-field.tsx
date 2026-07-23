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
        <p id={`${id}-error`} role="alert" className="form-message-text mt-1 text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const authInputClassName =
  "auth-control form-input-text w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200";
export const authErrorInputClassName =
  "border-red-500 focus:border-red-500 focus:ring-red-100";
export const authSubmitClassName =
  "auth-primary-button";
