"use client";

import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { LoadingLabel } from "@/components/ui/loading-label";

export function HeaderLoadingStatus({
  isLoading,
  label = "Đang tải",
}: {
  isLoading: boolean;
  label?: string;
}) {
  if (!isLoading) return null;

  return (
    <span className="caption-text inline-flex shrink-0 items-center text-gray-500">
      <LoadingLabel label={label} />
    </span>
  );
}

export function HeaderLoadingControls({
  actionCount = 0,
  showSearch = true,
}: {
  actionCount?: number;
  showSearch?: boolean;
}) {
  return (
    <HeaderControlsPortal>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showSearch ? (
          <div
            aria-hidden="true"
            className="h-9 w-full max-w-80 animate-pulse rounded-lg bg-gray-100"
          />
        ) : null}
        {Array.from({ length: actionCount }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="h-9 w-28 shrink-0 animate-pulse rounded-lg bg-gray-100"
          />
        ))}
        <HeaderLoadingStatus isLoading />
      </div>
    </HeaderControlsPortal>
  );
}
