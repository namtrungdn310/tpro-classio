import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { RiErrorWarningLine as ErrorIcon } from "react-icons/ri";
import { cn } from "@/lib/utils";

type InlineFormErrorProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactNode;
  /** Optional recovery control, e.g. a retry button shown inline. */
  action?: ReactNode;
};

/**
 * Compact form-level error line: red text without a box, with a small system
 * icon and an optional inline action. Field-level errors stay plain red text
 * under their own field via FormField.
 */
export function InlineFormError({
  action,
  children,
  className,
  ...props
}: InlineFormErrorProps) {
  return (
    <div
      {...props}
      role="alert"
      className={cn(
        "flex w-full min-w-0 items-center gap-2",
        className,
      )}
    >
      <ErrorIcon
        className="h-4 w-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <p className="helper-text min-w-0 flex-1 select-none break-words leading-5 text-destructive">
        {children}
      </p>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
