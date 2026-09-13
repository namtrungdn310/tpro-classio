/**
 * Shared helpers for the R8 performance E2E gate.
 *
 * Collects per-request timing and duplicate detection from the browser
 * request-tracking instrumentation exposed on `window.__tproPerf`, and
 * aggregates navigation metrics.  Kept dependency-free so it can run inside
 * the browser context via `page.evaluate`.
 */

export type PerfRequest = {
  id: string;
  method: string;
  path: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: number | null;
  responseBytes: number | null;
  duplicates: number;
  error?: string;
};

export function detectDuplicateRequests(requests: PerfRequest[]): PerfRequest[] {
  return requests.filter((request) => request.duplicates > 0);
}

export function summarizeRequests(requests: PerfRequest[]) {
  const byPath = new Map<string, { count: number; totalMs: number; bytes: number }>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const entry = byPath.get(key) ?? { count: 0, totalMs: 0, bytes: 0 };
    entry.count += 1;
    entry.totalMs += request.durationMs;
    entry.bytes += request.responseBytes ?? 0;
    byPath.set(key, entry);
  }
  return [...byPath.entries()].map(([key, value]) => ({ key, ...value }));
}

export function readPerfTrace(): PerfRequest[] {
  const trace = (globalThis as { __tproPerf?: { getTrace(): PerfRequest[] } })
    .__tproPerf;
  return trace ? trace.getTrace() : [];
}
