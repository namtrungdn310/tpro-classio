"use client";

import type { IconType } from "react-icons";
import { RiRefreshLine } from "react-icons/ri";
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
        "flex min-h-40 flex-col items-center justify-center rounded-lg border border-destructive/15 bg-destructive-soft/70 px-5 py-6 text-center",
        className,
      )}
    >
      <p className="font-ui text-sm font-semibold text-destructive">{title}</p>
      <p className="helper-text mt-1 max-w-md text-destructive">{description}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isRetrying}
        className="mt-3 border-destructive/20 bg-white text-destructive hover:bg-destructive-soft"
        onClick={onRetry}
      >
        {!isRetrying ? (
          <RiRefreshLine className="icon-system h-3.5 w-3.5" aria-hidden="true" />
        ) : null}
        {isRetrying ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
      </Button>
    </div>
  );
}

type DataSectionEmptyProps = {
  actionLabel?: string;
  className?: string;
  description?: string;
  icon: IconType;
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
        "flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-primary/15 bg-white/70 px-5 py-8 text-center",
        className,
      )}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="font-ui mt-3.5 text-[15px] font-semibold leading-6 text-gray-900">
        {title}
      </p>
      {description ? (
        <p className="helper-text mt-1 max-w-md text-gray-500">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
