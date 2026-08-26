"use client";

import { useEffect, useState } from "react";

/**
 * Returns the latest value only after it has been stable for `delayMs`.
 * Used to avoid firing expensive queries (schedule availability, server
 * search) on every keystroke or rapid picker change.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}