import { RiAlertLine as AlertCircle } from "react-icons/ri";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type UnsavedChangesNoticeProps = {
  hasChanges: boolean;
  hasErrors?: boolean;
  isSaving?: boolean;
  /** Optional context-specific copy while keeping the shared presentation. */
  message?: ReactNode;
  variant?: "inline" | "panel";
};

export function shouldShowUnsavedChanges({
  hasChanges,
  hasErrors = false,
  isSaving = false,
}: Omit<UnsavedChangesNoticeProps, "variant">) {
  return hasChanges && !hasErrors && !isSaving;
}

export function UnsavedChangesNotice({
  hasChanges,
  hasErrors = false,
  isSaving = false,
  message,
  variant = "panel",
}: UnsavedChangesNoticeProps) {
  if (!shouldShowUnsavedChanges({ hasChanges, hasErrors, isSaving })) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-w-0 text-amber-800",
        variant === "panel"
          ? "items-start gap-2"
          : "items-center gap-1.5 pt-1",
      )}
    >
      <AlertCircle
        className={cn("h-4 w-4 shrink-0", variant === "panel" && "mt-0.5")}
        aria-hidden="true"
      />
      <p className="form-message-text min-w-0 break-words leading-5">
        {message ?? <span className="font-semibold">Thay đổi chưa được lưu.</span>}
      </p>
    </div>
  );
}
