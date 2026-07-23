import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsCard({
  children,
  className,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 shrink-0 overflow-hidden rounded-xl border border-gray-200/90 bg-white",
        className,
      )}
    >
      <header className="flex shrink-0 select-none items-center gap-2.5 border-b border-gray-200 bg-gray-50/45 px-4 py-3 sm:px-5">
        {icon ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </span>
        ) : null}
        <h2 className="section-title-text text-gray-950">{title}</h2>
      </header>
      {children}
    </section>
  );
}

export function SettingsField({
  action,
  actionClassName,
  children,
  className,
  error,
  errorId,
  htmlFor,
  label,
}: {
  action?: ReactNode;
  actionClassName?: string;
  children: ReactNode;
  className?: string;
  error?: string;
  errorId: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className={cn("px-4 py-3 sm:px-5", className)}>
      <label htmlFor={htmlFor} className="form-label-text block select-none text-gray-700">
        {label}
      </label>
      <div className="mt-1.5 flex min-w-0 items-start gap-2.5">
        <div className="min-w-0 w-full max-w-[360px] flex-1">
          {children}
          {error ? (
            <p id={errorId} role="alert" className="form-message-text mt-1 text-red-600">
              {error}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className={cn("flex min-h-8 shrink-0 items-center", actionClassName)}>
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
