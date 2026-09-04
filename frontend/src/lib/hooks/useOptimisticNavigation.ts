"use client";

import { useEffect, useSyncExternalStore } from "react";

const NAVIGATION_FEEDBACK_TIMEOUT_MS = 4_000;

let pendingHref: string | null = null;
let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return pendingHref;
}

function clearNavigationIntent() {
  if (timeoutId !== null) {
    globalThis.clearTimeout(timeoutId);
    timeoutId = null;
  }
  if (pendingHref === null) return;
  pendingHref = null;
  emitChange();
}

function showNavigationIntent(href: string) {
  if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  pendingHref = href;
  emitChange();
  timeoutId = globalThis.setTimeout(
    clearNavigationIntent,
    NAVIGATION_FEEDBACK_TIMEOUT_MS,
  );
}

/**
 * Keeps navigation feedback immediate while the App Router resolves the next
 * route. The timeout prevents a failed navigation from leaving a tab selected.
 */
export function useOptimisticNavigation(pathname: string) {
  const sharedPendingHref = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  );

  useEffect(() => {
    clearNavigationIntent();
  }, [pathname]);

  return {
    optimisticPathname: sharedPendingHref ?? pathname,
    pendingHref: sharedPendingHref,
    showNavigationIntent,
  };
}
