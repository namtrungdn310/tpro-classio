"use client";

import { cn } from "@/lib/utils";

type SegmentedControlProps = {
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  onSelect: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  selected: string;
};

/**
 * Shared segmented control: a recessed gray track with a white elevated pill
 * for the active option.
 */
export function SegmentedControl({
  ariaLabelledBy,
  ariaDescribedBy,
  disabled = false,
  invalid = false,
  onSelect,
  options,
  selected,
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={cn(
        "grid h-8 overflow-hidden rounded-md border bg-gray-100 p-0.5",
        invalid ? "border-destructive ring-1 ring-destructive/15" : "border-gray-200",
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={cn(
              "form-input-text h-full rounded-[5px] px-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60",
              invalid
                ? "focus-visible:!ring-destructive/30"
                : "focus-visible:ring-primary/40",
              active
                ? "bg-white font-semibold text-primary shadow-sm ring-1 ring-inset ring-gray-200"
                : "text-gray-600 hover:bg-white/70 hover:text-gray-900",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
