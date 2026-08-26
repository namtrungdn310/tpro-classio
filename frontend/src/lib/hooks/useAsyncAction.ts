"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Wrap a non-mutation async handler with pending + inline-error state and
 * double-submit protection.  Feed `isPending` to a `PendingActionButton` so
 * the button flips to its loading state the moment the action starts and
 * stays locked until it settles.
 *
 * ``run`` returns the action result and re-throws so callers can branch on
 * success/failure; ``setError`` lets callers override the inline message with
 * a server-provided, user-friendly translation.
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (...args: Args) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setIsPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [action],
  );

  return { error, isPending, run, setError };
}