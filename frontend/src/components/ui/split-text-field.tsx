import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { InlineFieldDivider } from "@/components/ui/inline-field-divider";
import { cn } from "@/lib/utils";

export const splitTextFieldClassName =
  "split-text-field grid w-full min-w-0 items-center";

export function SplitTextField({
  className,
  endAdornment,
  left,
  leftClassName,
  right,
  rightClassName,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  endAdornment?: ReactNode;
  left: ReactNode;
  leftClassName?: string;
  right: ReactNode;
  rightClassName?: string;
}) {
  return (
    <div {...props} className={cn(splitTextFieldClassName, className)}>
      <div className={cn("h-full min-w-0", leftClassName)}>{left}</div>
      <span
        aria-hidden="true"
        className="split-text-field-divider-zone pointer-events-none flex h-full items-center justify-center"
      >
        <InlineFieldDivider />
      </span>
      <div className={cn("h-full min-w-0", rightClassName)}>{right}</div>
      {endAdornment}
    </div>
  );
}
