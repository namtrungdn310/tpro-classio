import type { UserMe } from "@/lib/api/auth";
import { isPrivateAvatarUrl } from "@/lib/auth/avatar-url";

export const ACCESS_TOKEN_COOKIE_KEY = "tpro_access_token";
export const REFRESH_TOKEN_COOKIE_KEY = "tpro_refresh_token";
export const DEVICE_ID_COOKIE_KEY = "tpro_device_id";
export const PASSWORD_RESET_COOKIE_KEY = "tpro_password_reset";
export const FLOW_SESSION_COOKIE_KEY = "tpro_flow_session";
const AUTH_BROADCAST_KEY = "tpro_auth_signal";
const EXPIRY_SKEW_MS = 30_000;

type TokenPayload = {
  sub?: string;
  email?: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: string;
  is_owner?: boolean;
  exp?: number;
};

let cachedDecodedToken: string | null = null;
let cachedDecodedPayload: TokenPayload | null = null;

function resetDecodedTokenCache() {
  cachedDecodedToken = null;
  cachedDecodedPayload = null;
}

export function announceAuthChanged(): void {
  resetDecodedTokenCache();
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(AUTH_BROADCAST_KEY, String(Date.now()));
  } catch {
  }
}

export function isAuthBroadcastStorageKey(key: string | null): boolean {
  return key === AUTH_BROADCAST_KEY;
}

function decodeToken(token: string): TokenPayload | null {
  if (token === cachedDecodedToken) {
    return cachedDecodedPayload;
  }

  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) {
      cachedDecodedToken = token;
      cachedDecodedPayload = null;
      return null;
    }

    const normalizedPayload = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    const decodedPayload =
      typeof window !== "undefined"
        ? window.atob(paddedPayload)
        : Buffer.from(paddedPayload, "base64").toString("utf-8");
    const payload = JSON.parse(decodedPayload) as TokenPayload;
    cachedDecodedToken = token;
    cachedDecodedPayload = payload;
    return payload;
  } catch {
    cachedDecodedToken = token;
    cachedDecodedPayload = null;
    return null;
  }
}

function isTokenExpired(payload: TokenPayload, skewMs = EXPIRY_SKEW_MS): boolean {
  return payload.exp ? payload.exp * 1000 <= Date.now() + skewMs : true;
}

function getUserFromPayload(payload: TokenPayload): UserMe | null {
  if (
    !payload.sub ||
    !payload.email ||
    (payload.role !== "admin" && payload.role !== "viewer")
  ) {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    username: payload.username ?? null,
    full_name: payload.full_name ?? null,
    avatar_url:
      typeof payload.avatar_url === "string" && isPrivateAvatarUrl(payload.avatar_url, payload.sub)
        ? payload.avatar_url
        : null,
    is_owner: Boolean(payload.is_owner),
  };
}

export function getUserFromToken(
  token: string | null,
  options: { allowExpired?: boolean } = {},
): UserMe | null {
  if (!token) {
    return null;
  }

  const payload = decodeToken(token);
  if (!payload || (!options.allowExpired && isTokenExpired(payload))) {
    return null;
  }

  return getUserFromPayload(payload);
}
