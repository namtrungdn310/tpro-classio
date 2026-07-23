import { FLOW_SESSION_COOKIE_KEY } from "@/lib/auth/session";

// Preserve the backend's shorter login-MFA TTL while bounding every pre-auth
// cookie to the maximum onboarding lifetime.
const FLOW_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const FLOW_COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type FlowCookieMutation = {
  value: string;
  maxAge?: number;
  clear: boolean;
};

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

function getSetCookieValues(headers: Headers): string[] {
  const values = (headers as HeadersWithSetCookie).getSetCookie?.();
  if (values?.length) {
    return values;
  }

  const fallback = headers.get("set-cookie");
  return fallback ? [fallback] : [];
}

/**
 * Extract only the opaque pre-auth cookie emitted by the backend. Other
 * upstream cookies must never cross the BFF boundary.
 */
export function readUpstreamFlowCookie(headers: Headers): FlowCookieMutation | null {
  const prefix = `${FLOW_SESSION_COOKIE_KEY}=`;
  const rawCookie = getSetCookieValues(headers).find((value) =>
    value.trimStart().startsWith(prefix),
  );
  if (!rawCookie) {
    return null;
  }

  const firstPart = rawCookie.slice(rawCookie.indexOf(prefix) + prefix.length).split(";", 1)[0];
  const value = firstPart.replace(/^"|"$/g, "");
  const maxAgeMatch = rawCookie.match(/(?:^|;)\s*max-age=(-?\d+)/i);
  const parsedMaxAge = maxAgeMatch ? Number.parseInt(maxAgeMatch[1], 10) : undefined;
  const maxAge = Number.isFinite(parsedMaxAge)
    ? Math.min(FLOW_COOKIE_MAX_AGE_SECONDS, Math.max(0, parsedMaxAge as number))
    : undefined;

  if (value && !FLOW_COOKIE_VALUE_PATTERN.test(value)) {
    return null;
  }

  return {
    value,
    maxAge,
    clear: value.length === 0 || (maxAge !== undefined && maxAge <= 0),
  };
}
