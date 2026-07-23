import type { SessionCookiePayload } from "@/lib/server/auth-cookies";

export type SessionRefreshResult =
  | { kind: "refreshed"; session: SessionCookiePayload }
  | { kind: "invalid" };

type RefreshEntry = {
  expiresAt: number;
  promise: Promise<SessionRefreshResult>;
};

/**
 * Serializes refresh-token rotation for one Next.js process and retains the
 * resolved token pair for a short grace window. Keeping the resolved value is
 * important: browser requests that were already in flight can still carry the
 * previous HttpOnly cookie after the first refresh response has completed.
 */
export class SessionRefreshCoordinator {
  private readonly entries = new Map<string, RefreshEntry>();

  constructor(
    private readonly graceMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 512,
  ) {}

  run(
    key: string,
    refresh: () => Promise<SessionRefreshResult>,
  ): Promise<SessionRefreshResult> {
    const now = this.now();
    this.pruneExpired(now);

    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.promise;
    }

    const entry: RefreshEntry = {
      expiresAt: now + this.graceMs,
      promise: Promise.resolve().then(refresh),
    };
    entry.promise = entry.promise.then(
        (result) => {
          if (this.entries.get(key) === entry) {
            entry.expiresAt = this.now() + this.graceMs;
          }
          return result;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) {
            this.entries.delete(key);
          }
          throw error;
        },
      );
    this.entries.set(key, entry);
    this.pruneOverflow();
    return entry.promise;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private pruneOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
