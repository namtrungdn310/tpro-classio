import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** A single physical divider token shared by schedules and compact forms. */
export const inlineFieldDividerClassName =
  "inline-field-divider pointer-events-none block shrink-0";

export function InlineFieldDivider({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(inlineFieldDividerClassName, className)}
    />
  );
}
