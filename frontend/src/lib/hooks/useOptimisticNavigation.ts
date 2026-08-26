"use client";

import { useEffect, useState } from "react";

const NAVIGATION_FEEDBACK_TIMEOUT_MS = 4_000;

/**
 * Keeps navigation feedback immediate while the App Router resolves the next
 * route. The timeout prevents a failed navigation from leaving a tab selected.
 */
export function useOptimisticNavigation(pathname: string) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;

    const timeout = window.setTimeout(
      () => setPendingHref(null),
      NAVIGATION_FEEDBACK_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  return {
    optimisticPathname: pendingHref ?? pathname,
    showNavigationIntent: setPendingHref,
  };
}
