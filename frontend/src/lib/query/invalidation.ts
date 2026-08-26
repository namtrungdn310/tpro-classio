"use client";

import type { QueryClient } from "@tanstack/react-query";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { staffQueryKeys } from "@/lib/staff/query-keys";
import { studentQueryKeys } from "@/lib/students/query-keys";

export type DomainInvalidationOptions = {
  classes?: boolean;
  dashboard?: boolean;
  fees?: boolean;
  reports?: boolean;
  students?: boolean;
  staff?: boolean;
  transactions?: boolean;
};

/**
 * One canonical invalidation matrix for domain caches.
 *
 * Pages pass exactly the domains a mutation truly affects instead of spreading
 * raw `["classes"]`/`["fees"]` strings around.  A mutation should never blast
 * every domain at once — invalidating unrelated caches causes the very
 * refetch storms the performance pass targets.
 */
export function invalidateDomainQueries(
  queryClient: QueryClient,
  options: DomainInvalidationOptions,
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  if (options.classes) {
    tasks.push(queryClient.invalidateQueries({ queryKey: classQueryKeys.all }));
  }
  if (options.dashboard) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["dashboard"] }));
  }
  if (options.fees) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["fees"] }));
  }
  if (options.reports) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["reports"] }));
  }
  if (options.students) {
    tasks.push(queryClient.invalidateQueries({ queryKey: studentQueryKeys.all }));
  }
  if (options.staff) {
    tasks.push(queryClient.invalidateQueries({ queryKey: staffQueryKeys.root }));
  }
  if (options.transactions) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["fee-transactions"] }));
  }
  return Promise.all(tasks).then(() => undefined);
}
