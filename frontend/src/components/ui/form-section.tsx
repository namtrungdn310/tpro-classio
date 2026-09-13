import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type FormSectionProps = {
  label?: string;
  /** Stable chapter number, rendered as 1, 2, 3… Never derived at render time. */
  order?: number;
  /** Right-aligned status summary, e.g. "2 nhân sự" or "3 buổi/tuần". */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * "Chương mục" field group: a numbered chapter header plus content on a
 * light gray-blue surface. Boundaries come from the surface itself, not from
 * colored rules or full-width lines. The number is decorative and stable.
 */
export function FormSection({
  label,
  order,
  summary,
  children,
  className,
}: FormSectionProps) {
  const generatedLabelId = useId();
  const labelId = label ? generatedLabelId : undefined;

  return (
    <section
      aria-labelledby={labelId}
      className={cn(
        "min-w-0 rounded-[10px] border border-gray-200 bg-[#f7f9fc]",
        className,
      )}
    >
      {label ? (
        <header className="flex select-none items-center gap-2 px-3.5 pb-3 pt-3.5">
          {order !== undefined ? (
            <span
              aria-hidden="true"
              className="font-ui inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-primary-soft px-1 text-[12px] font-bold leading-6 tabular-nums text-primary"
            >
              {order}
            </span>
          ) : null}
          <h3
            id={labelId}
            className="form-section-title-text min-w-0 flex-1 select-none truncate text-gray-950"
          >
            {label}
          </h3>
          {summary ? (
            <span className="shrink-0 select-none text-[12px] font-semibold leading-4 text-gray-500">
              {summary}
            </span>
          ) : null}
        </header>
      ) : null}
      <div className="space-y-3 px-3.5 pb-3.5">{children}</div>
    </section>
  );
}
