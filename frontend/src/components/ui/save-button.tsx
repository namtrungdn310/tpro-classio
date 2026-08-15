import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { cn } from "@/lib/utils";

type SaveButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  idleLabel?: string;
  isSaving: boolean;
  pendingLabel?: string;
};

export function SaveButton({
  className,
  disabled,
  idleLabel = "Lưu",
  isSaving,
  pendingLabel = "Đang lưu",
  ...props
}: SaveButtonProps) {
  return (
    <Button
      {...props}
      className={cn(
        "h-8 w-fit rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90",
        className,
      )}
      disabled={isSaving || disabled}
      aria-busy={isSaving || undefined}
    >
      {isSaving ? <LoadingLabel label={pendingLabel} /> : idleLabel}
    </Button>
  );
}
