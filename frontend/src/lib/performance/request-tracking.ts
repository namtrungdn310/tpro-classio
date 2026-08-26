/**
 * Browser-side request instrumentation for the API client.
 *
 * Tracks one entry per HTTP request: request id, route (path only — query
 * strings are dropped so search terms never reach the trace), timing, HTTP
 * status, response size and duplicate requests within the same interaction.
 *
 * Privacy rules: this module never records student names, phone numbers,
 * notes, tokens or fee details.  Storing path-only URLs keeps search queries
 * (which can contain names) out of the trace by construction.
 */

export type TrackedRequest = {
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

type RequestMeta = {
  id: string;
  method: string;
  path: string;
  startedAt: number;
};

export type { RequestMeta };

const MAX_TRACKED = 120;
const DUPLICATE_WINDOW_MS = 3000;

let trace: TrackedRequest[] = [];
const listeners = new Set<(trace: TrackedRequest[]) => void>();
const recentStarts = new Map<string, number>();

export function getRequestTrace(): TrackedRequest[] {
  return [...trace];
}

export function clearRequestTrace(): void {
  trace = [];
  recentStarts.clear();
  for (const listener of listeners) {
    listener(trace);
  }
}

export function subscribeToRequests(
  listener: (trace: TrackedRequest[]) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function pathOnly(value: string): string {
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  try {
    const url = new URL(value, base);
    return url.pathname;
  } catch {
    return value.split("?")[0] ?? value;
  }
}

function generateRequestId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return random.replace(/-/g, "").slice(0, 16);
}

export function startRequestTracking(method: string, url: string): RequestMeta {
  const id = generateRequestId();
  const path = pathOnly(url);
  const key = `${method} ${path}`;
  const now = Date.now();
  const lastStartedAt = recentStarts.get(key) ?? 0;
  if (now - lastStartedAt > DUPLICATE_WINDOW_MS) {
    recentStarts.delete(key);
  }
  recentStarts.set(key, now);
  return { id, method, path, startedAt: performance.now() };
}

export function completeRequestTracking(
  meta: RequestMeta,
  status: number | null,
  responseBytes: number | null,
  error?: string,
): void {
  const completedAt = performance.now();
  const key = `${meta.method} ${meta.path}`;
  const duplicates = countDuplicates(key, meta.startedAt);
  const entry: TrackedRequest = {
    id: meta.id,
    method: meta.method,
    path: meta.path,
    startedAt: meta.startedAt,
    completedAt,
    durationMs: completedAt - meta.startedAt,
    status,
    responseBytes,
    duplicates,
    ...(error ? { error } : {}),
  };
  trace = [...trace, entry];
  if (trace.length > MAX_TRACKED) {
    trace = trace.slice(trace.length - MAX_TRACKED);
  }
  for (const listener of listeners) {
    listener(trace);
  }
}

function countDuplicates(key: string, startedAt: number): number {
  let duplicates = 0;
  for (const entry of trace) {
    const entryKey = `${entry.method} ${entry.path}`;
    if (entryKey !== key) {
      continue;
    }
    const startedAfter = entry.startedAt >= startedAt - DUPLICATE_WINDOW_MS;
    if (startedAfter) {
      duplicates += 1;
    }
  }
  return duplicates;
}