const DEVICE_STORAGE_KEY = "tpro:device-id";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function normalizeDeviceId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return DEVICE_ID_PATTERN.test(normalized) ? normalized : null;
}

function generateDeviceId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID().replaceAll("-", "");
  }

  if (typeof window.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // A device identifier participates in server-side session binding. If the
  // browser has no cryptographically secure RNG, fail closed instead of
  // creating a predictable fallback value.
  return null;
}

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    const normalized = normalizeDeviceId(storedValue);
    if (!normalized && storedValue !== null) {
      window.localStorage.removeItem(DEVICE_STORAGE_KEY);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function ensureDeviceId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = getStoredDeviceId();
  if (existing) {
    return existing;
  }

  const next = generateDeviceId();
  if (!next) {
    return null;
  }
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  } catch {
    return next;
  }
  return next;
}
