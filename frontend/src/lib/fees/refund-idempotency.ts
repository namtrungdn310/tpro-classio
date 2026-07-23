const REFUND_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "tpro:fee-refund:pending:";

type PendingRefundRequest = {
  createdAt: number;
  fingerprintHash: string;
  requestId: string;
};

type MinimalStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const volatilePendingRequests = new Map<string, string>();

export function getOrCreateRefundRequestId(
  scope: string,
  fingerprint: string,
  options: {
    createId?: () => string;
    now?: number;
    storage?: MinimalStorage | null;
  } = {},
) {
  const storage = options.storage ?? getSessionStorage();
  const now = options.now ?? Date.now();
  const fingerprintHash = hashFingerprint(fingerprint);
  const key = getStorageKey(scope);
  const current = readPendingRequest(storage, key);
  if (
    current &&
    now - current.createdAt <= REFUND_REQUEST_TTL_MS &&
    current.fingerprintHash === fingerprintHash
  ) {
    return current.requestId;
  }

  const requestId = (options.createId ?? (() => crypto.randomUUID()))();
  const pending: PendingRefundRequest = {
    createdAt: now,
    fingerprintHash,
    requestId,
  };
  safelySetItem(storage, key, JSON.stringify(pending));
  return requestId;
}

export function clearPendingRefundRequest(
  scope: string,
  requestId: string,
  storage: MinimalStorage | null = getSessionStorage(),
) {
  const key = getStorageKey(scope);
  const current = readPendingRequest(storage, key);
  if (current?.requestId === requestId) {
    safelyRemoveItem(storage, key);
  }
}

function readPendingRequest(
  storage: MinimalStorage | null,
  key: string,
): PendingRefundRequest | null {
  const raw = safelyGetItem(storage, key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingRefundRequest>;
    if (
      typeof value.createdAt === "number" &&
      typeof value.fingerprintHash === "string" &&
      typeof value.requestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.requestId,
      )
    ) {
      return value as PendingRefundRequest;
    }
  } catch {
    // A malformed browser value is disposable and must never block billing.
  }
  safelyRemoveItem(storage, key);
  return null;
}

function getSessionStorage(): MinimalStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safelyGetItem(storage: MinimalStorage | null, key: string) {
  try {
    const value = storage?.getItem(key);
    if (value !== null && value !== undefined) return value;
  } catch {
    // Fall through to the tab-local copy when browser storage is unavailable.
  }
  return volatilePendingRequests.get(key) ?? null;
}

function safelySetItem(
  storage: MinimalStorage | null,
  key: string,
  value: string,
) {
  volatilePendingRequests.set(key, value);
  try {
    storage?.setItem(key, value);
  } catch {
    // The in-memory copy still keeps retries idempotent for this browser tab.
  }
}

function safelyRemoveItem(storage: MinimalStorage | null, key: string) {
  volatilePendingRequests.delete(key);
  try {
    storage?.removeItem(key);
  } catch {
    // The browser value is inaccessible; clearing the in-memory copy is enough.
  }
}

function getStorageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`;
}

function hashFingerprint(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}
