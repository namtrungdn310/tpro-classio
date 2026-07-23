import type { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_KEY,
  DEVICE_ID_COOKIE_KEY,
  FLOW_SESSION_COOKIE_KEY,
  PASSWORD_RESET_COOKIE_KEY,
  REFRESH_TOKEN_COOKIE_KEY,
} from "@/lib/auth/session";

const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS = 60 * 10;
// Backend owns the exact flow TTL (login MFA: 5 minutes; onboarding: 15).
// The BFF only enforces the longest permitted pre-auth lifetime.
const FLOW_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 15;

export function resolveSecureCookieSetting(
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  const configured = configuredValue?.trim().toLowerCase();
  if (configured === "true" || configured === "1") return true;
  if (configured === "false" || configured === "0") return false;
  return nodeEnvironment === "production";
}

function isSecureCookie(): boolean {
  return resolveSecureCookieSetting(process.env.AUTH_COOKIE_SECURE, process.env.NODE_ENV);
}

function buildCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: isSecureCookie(),
  };
}

export type SessionCookiePayload = {
  access_token: string;
  refresh_token: string;
};

export function applyDeviceCookie(response: NextResponse, deviceId: string): void {
  response.cookies.set(
    DEVICE_ID_COOKIE_KEY,
    deviceId,
    {
      httpOnly: true,
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: isSecureCookie(),
    },
  );
}

export function applySessionCookies(
  response: NextResponse,
  payload: SessionCookiePayload,
): void {
  response.cookies.set(
    ACCESS_TOKEN_COOKIE_KEY,
    payload.access_token,
    buildCookieOptions(ACCESS_COOKIE_MAX_AGE_SECONDS),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE_KEY,
    payload.refresh_token,
    buildCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  );
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE_KEY, "", buildCookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE_KEY, "", buildCookieOptions(0));
}

export function applyPasswordResetCookie(
  response: NextResponse,
  resetToken: string,
  maxAge = PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
): void {
  response.cookies.set(
    PASSWORD_RESET_COOKIE_KEY,
    resetToken,
    {
      ...buildCookieOptions(maxAge),
      sameSite: "strict",
    },
  );
}

export function clearPasswordResetCookie(response: NextResponse): void {
  response.cookies.set(
    PASSWORD_RESET_COOKIE_KEY,
    "",
    {
      ...buildCookieOptions(0),
      sameSite: "strict",
    },
  );
}

export function applyFlowSessionCookie(
  response: NextResponse,
  value: string,
  maxAge = FLOW_SESSION_COOKIE_MAX_AGE_SECONDS,
): void {
  const boundedMaxAge = Math.min(
    FLOW_SESSION_COOKIE_MAX_AGE_SECONDS,
    Math.max(1, Math.trunc(maxAge)),
  );
  response.cookies.set(FLOW_SESSION_COOKIE_KEY, value, buildCookieOptions(boundedMaxAge));
}

export function clearFlowSessionCookie(response: NextResponse): void {
  response.cookies.set(FLOW_SESSION_COOKIE_KEY, "", buildCookieOptions(0));
}
