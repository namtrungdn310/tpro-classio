import type { NextResponse } from "next/server";
import type { FlowCookieMutation } from "@/lib/server/flow-cookie";
import {
  applyDeviceCookie,
  applyFlowSessionCookie,
  applyPasswordResetCookie,
  applySessionCookies,
  clearFlowSessionCookie,
  clearPasswordResetCookie,
  clearSessionCookies,
  type SessionCookiePayload,
} from "@/lib/server/auth-cookies";

export type ProxyResponseCookieOptions = {
  session?: SessionCookiePayload | null;
  deviceId?: string | null;
  clearSession?: boolean;
  passwordReset?: {
    token: string;
    maxAge?: number;
  } | null;
  clearPasswordReset?: boolean;
  flowMutation?: FlowCookieMutation | null;
  clearFlow?: boolean;
};

/**
 * Apply every browser-owned authentication cookie in one place.
 *
 * A refreshed session must be committed even when the retried upstream request
 * returns binary data or fails. Supabase rotates refresh tokens, so dropping
 * that Set-Cookie response would leave the browser holding an invalid token.
 */
export function applyProxyResponseCookies(
  response: NextResponse,
  options: ProxyResponseCookieOptions,
): NextResponse {
  if (options.session) {
    applySessionCookies(response, options.session);
  }
  if (options.deviceId) {
    applyDeviceCookie(response, options.deviceId);
  }
  if (options.clearSession) {
    clearSessionCookies(response);
  }
  if (options.passwordReset) {
    applyPasswordResetCookie(
      response,
      options.passwordReset.token,
      options.passwordReset.maxAge,
    );
  }
  if (options.clearPasswordReset) {
    clearPasswordResetCookie(response);
  }
  if (options.flowMutation) {
    if (options.flowMutation.clear) {
      clearFlowSessionCookie(response);
    } else {
      applyFlowSessionCookie(
        response,
        options.flowMutation.value,
        options.flowMutation.maxAge,
      );
    }
  }
  if (options.clearFlow) {
    clearFlowSessionCookie(response);
  }

  return response;
}
