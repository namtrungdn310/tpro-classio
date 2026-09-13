"use client";

import type { ReactNode } from "react";
import { RiCloseLine as X } from "react-icons/ri";

import { cn } from "@/lib/utils";

type FormDialogHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  titleId?: string;
  descriptionId?: string;
  onClose: () => void;
  closeDisabled?: boolean;
  right?: ReactNode;
  className?: string;
};

/**
 * Shared dialog header: white surface, single bottom rule, bold title on the
 * left and the close control on the right. No colored band, no extra rules.
 */
export function FormDialogHeader({
  title,
  subtitle,
  titleId,
  descriptionId,
  onClose,
  closeDisabled,
  right,
  className,
}: FormDialogHeaderProps) {
  return (
    <div className={cn("shrink-0 border-b border-gray-200 bg-white", className)}>
      <div className="flex items-center justify-between gap-4 py-3 pl-4 pr-3 sm:pl-5 sm:pr-4">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="font-ui min-w-0 select-none text-[20px] font-bold leading-7 text-gray-950"
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              id={descriptionId}
              className="mt-0.5 select-none text-[13px] font-medium leading-4 text-gray-500"
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {right}
        <button
          type="button"
          aria-label="Đóng"
          title="Đóng"
          disabled={closeDisabled}
          onClick={onClose}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
