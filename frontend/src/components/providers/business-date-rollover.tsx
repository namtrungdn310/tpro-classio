"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Date-authoritative class visibility changes at Vietnam midnight. Refresh all
 * affected active queries at that boundary so a long-lived tab cannot retain a
 * class that has just completed or expose a class before its opening date.
 */
export function BusinessDateRollover() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const now = new Date();
      const vietnamNow = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS);
      const nextMidnightUtc = Date.UTC(
        vietnamNow.getUTCFullYear(),
        vietnamNow.getUTCMonth(),
        vietnamNow.getUTCDate() + 1,
      ) - VIETNAM_UTC_OFFSET_MS;
      const delay = Math.max(1_000, nextMidnightUtc - now.getTime() + 250);

      timer = setTimeout(() => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["classes"] }),
          queryClient.invalidateQueries({ queryKey: ["students"] }),
          queryClient.invalidateQueries({ queryKey: ["fees"] }),
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["staff"] }),
        ]).finally(schedule);
      }, delay);
    };

    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  return null;
}
