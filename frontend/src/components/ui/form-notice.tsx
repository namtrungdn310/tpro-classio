import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  RiAlertLine as AlertIcon,
  RiInformationLine as InfoIcon,
  RiLoader4Line as LoaderIcon,
} from "react-icons/ri";
import { cn } from "@/lib/utils";

type FormNoticeProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactNode;
  tone?: "info" | "warning";
  /** Shows an explicit progress signal while the message is being resolved. */
  loading?: boolean;
};

/** Shared note surface. Warnings use the same component so form feedback stays consistent. */
export function FormNotice({
  children,
  className,
  loading = false,
  tone = "info",
  ...props
}: FormNoticeProps) {
  const isWarning = tone === "warning";
  return (
    <div
      {...props}
      role={loading ? "status" : "note"}
      aria-busy={loading || undefined}
      aria-live={loading ? "polite" : undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-2 rounded-md border px-3 py-2",
        isWarning
          ? "border-amber-200 bg-amber-50"
          : "border-primary/15 bg-primary-soft",
        className,
      )}
    >
      {loading ? (
        <LoaderIcon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none",
            isWarning ? "text-amber-700" : "text-primary",
          )}
          aria-hidden="true"
        />
      ) : isWarning ? (
        <AlertIcon
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
          aria-hidden="true"
        />
      ) : (
        <InfoIcon
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          aria-hidden="true"
        />
      )}
      <p
        className={cn(
          "helper-text min-w-0 select-none break-words leading-5",
          isWarning ? "text-amber-800" : "text-gray-600",
        )}
      >
        <span className={cn("font-semibold", isWarning ? "text-amber-900" : "text-gray-700")}>
          Lưu ý:
        </span>{" "}
        {children}
      </p>
    </div>
  );
}
