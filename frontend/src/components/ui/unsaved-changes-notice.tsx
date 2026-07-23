import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type UnsavedChangesNoticeProps = {
  hasChanges: boolean;
  hasErrors?: boolean;
  isSaving?: boolean;
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
        "flex text-amber-800",
        variant === "panel"
          ? "items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
          : "items-center gap-1.5 pt-1",
      )}
    >
      <AlertCircle
        className={cn("h-4 w-4 shrink-0", variant === "panel" && "mt-0.5")}
        aria-hidden="true"
      />
      <p className="form-message-text">
        <span className="font-semibold">Thay đổi chưa được lưu.</span>{" "}
        <span className={variant === "inline" ? "sr-only" : undefined}>
          Nhấn Lưu để áp dụng.
        </span>
      </p>
    </div>
  );
}
