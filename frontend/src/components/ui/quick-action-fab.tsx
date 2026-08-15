"use client";

import { RiAddLine as Plus } from "react-icons/ri";

type QuickActionFabProps = {
  label: string;
  onClick: () => void;
};

/** Floating create-action button, shown on small screens so the primary add
 *  action stays reachable without scrolling back to the page header. */
export function QuickActionFab({ label, onClick }: QuickActionFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(0,39,135,0.35)] transition-[background-color,transform] duration-150 ease-out outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:translate-y-px md:hidden"
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
