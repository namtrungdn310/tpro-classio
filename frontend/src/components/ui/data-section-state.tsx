"use client";

import { RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingLabel } from "@/components/ui/loading-label";
import { cn } from "@/lib/utils";

type DataSectionErrorProps = {
  className?: string;
  description: string;
  isRetrying?: boolean;
  onRetry: () => void;
  title: string;
};

export function DataSectionError({
  className,
  description,
  isRetrying = false,
  onRetry,
  title,
}: DataSectionErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center rounded-lg border border-red-100 bg-red-50/70 px-5 py-6 text-center",
        className,
      )}
    >
      <p className="font-ui text-sm font-semibold text-red-800">{title}</p>
      <p className="helper-text mt-1 max-w-md text-red-700">{description}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isRetrying}
        className="mt-3 border-red-200 bg-white text-red-800 hover:bg-red-50"
        onClick={onRetry}
      >
        {!isRetrying ? (
          <RefreshCw className="h-3.5 w-3.5" />
        ) : null}
        {isRetrying ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
      </Button>
    </div>
  );
}

type DataSectionEmptyProps = {
  actionLabel?: string;
  className?: string;
  description: string;
  icon: LucideIcon;
  onAction?: () => void;
  title: string;
};

export function DataSectionEmpty({
  actionLabel,
  className,
  description,
  icon: Icon,
  onAction,
  title,
}: DataSectionEmptyProps) {
  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white/60 px-5 py-8 text-center",
        className,
      )}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="font-ui mt-3 text-sm font-semibold text-gray-800">{title}</p>
      <p className="helper-text mt-1 max-w-md text-gray-500">{description}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
