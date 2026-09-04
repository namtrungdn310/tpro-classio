import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusPillTone = "primary" | "amber" | "neutral" | "success" | "gray" | "emerald";

const TONE_CLASS: Record<StatusPillTone, string> = {
  primary: "border-primary/20 bg-primary-soft text-primary",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-gray-200 bg-gray-50 text-gray-700",
  gray: "border-gray-200 bg-gray-50 text-gray-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

type StatusPillProps = {
  children: ReactNode;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  tone?: StatusPillTone;
};

/** Shared small status used beside dates and other secondary metadata. */
export function StatusPill({
  children,
  className,
  onClick,
  title,
  tone = "primary",
}: StatusPillProps) {
  const classes = cn(
    "inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[11px] font-medium leading-none",
    TONE_CLASS[tone],
    onClick &&
      "cursor-pointer transition-colors hover:border-primary/30 hover:bg-primary-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        aria-label={title}
        className={classes}
        onClick={onClick}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {children}
      </button>
    );
  }

  return (
    <span title={title} className={classes}>
      {children}
    </span>
  );
}
