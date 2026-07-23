import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_KEY,
  FLOW_SESSION_COOKIE_KEY,
  REFRESH_TOKEN_COOKIE_KEY,
} from "@/lib/auth/session";

const AUTH_PAGES = new Set(["/login", "/register", "/reset-password", "/otp"]);
const PRE_AUTH_PAGES = new Set([
  "/login/totp",
  "/onboarding/google",
  "/onboarding/recovery",
  "/onboarding/totp",
]);
const PROTECTED_PREFIXES = [
  "/classes",
  "/fees",
  "/report",
  "/settings",
  "/staff",
  "/students",
];
const TOKEN_EXPIRY_SKEW_MS = 30_000;

type ProxyTokenPayload = {
  exp?: number;
};

function isProtectedPath(pathname: string): boolean {
  return pathname === "/" || PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function decodeTokenPayload(token: string | undefined): ProxyTokenPayload | null {
  if (!token) {
    return null;
  }

  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) {
      return null;
    }

    const normalizedPayload = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    return JSON.parse(atob(paddedPayload)) as ProxyTokenPayload;
  } catch {
    return null;
  }
}

function hasValidAccessToken(request: NextRequest): boolean {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_KEY)?.value;
  const payload = decodeTokenPayload(accessToken);
  return Boolean(payload?.exp && payload.exp * 1000 > Date.now() + TOKEN_EXPIRY_SKEW_MS);
}

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();

  return forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:";
}

function applySecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
  );
  response.headers.set(
    "Referrer-Policy",
    request.nextUrl.pathname === "/register" ||
      request.nextUrl.pathname === "/auth/google/callback"
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");
  // Browsers persist HSTS per host. Sending it over local HTTP makes subsequent
  // localhost requests upgrade to HTTPS even though the development port has no TLS.
  if (process.env.NODE_ENV === "production" && isHttpsRequest(request)) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccessSession = hasValidAccessToken(request);
  const hasRefreshSession = request.cookies.has(REFRESH_TOKEN_COOKIE_KEY);
  const hasFlowSession = request.cookies.has(FLOW_SESSION_COOKIE_KEY);

  if ((AUTH_PAGES.has(pathname) || PRE_AUTH_PAGES.has(pathname)) && hasAccessSession) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/", request.url)), request);
  }

  if (PRE_AUTH_PAGES.has(pathname) && !hasFlowSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("reason", "flow-expired");
    return applySecurityHeaders(NextResponse.redirect(loginUrl), request);
  }

  if (isProtectedPath(pathname) && !hasAccessSession && !hasRefreshSession) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/login", request.url)), request);
  }

  return applySecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo-mark-bw.png).*)"],
};
