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
        "h-8 w-fit rounded-md bg-gray-950 px-3 text-sm text-white hover:bg-black",
        className,
      )}
      disabled={isSaving || disabled}
    >
      {isSaving ? <LoadingLabel label={pendingLabel} /> : idleLabel}
    </Button>
  );
}
