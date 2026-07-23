const DEVICE_STORAGE_KEY = "tpro:device-id";

function generateDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
}

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(DEVICE_STORAGE_KEY)?.trim() ?? "";
    return value || null;
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
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  } catch {
    return next;
  }
  return next;
}
