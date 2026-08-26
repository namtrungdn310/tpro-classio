import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";

type PendingActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children"
> & {
  isPending: boolean;
  pendingLabel: string;
  children: ReactNode;
};

/**
 * Action button with a standardized pending state for mutations.
 *
 * - flips to a LoadingLabel the moment `isPending` becomes true (React Query
 *   sets `isPending` synchronously on `mutate`, so this is instant on click);
 * - the button width hugs its content: the idle label and the pending label
 *   each size the button naturally ("Lưu" stays tight, "Đang lưu" expands);
 * - disables itself while pending, which blocks double-click/re-submit;
 * - exposes `aria-busy` for assistive technology.
 */
export function PendingActionButton({
  className,
  disabled,
  isPending,
  pendingLabel,
  children,
  ...props
}: PendingActionButtonProps) {
  return (
    <Button
      {...props}
      className={className}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
    >
      {isPending ? (
        <LoadingLabel label={pendingLabel} />
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {children}
        </span>
      )}
    </Button>
  );
}