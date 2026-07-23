import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_KEY,
  DEVICE_ID_COOKIE_KEY,
  FLOW_SESSION_COOKIE_KEY,
  PASSWORD_RESET_COOKIE_KEY,
  REFRESH_TOKEN_COOKIE_KEY,
} from "@/lib/auth/session";
import type { SessionCookiePayload } from "@/lib/server/auth-cookies";
import {
  buildBackendUrl,
  getBackendBaseUrl,
  isPublicAuthProxyPath,
  usesFlowSessionProxyPath,
} from "@/lib/server/backend";
import {
  isBackendResponsePayload,
  sanitizeBackendResponsePayload,
  type BackendResponsePayload,
} from "@/lib/server/backend-response";
import {
  SessionRefreshCoordinator,
  type SessionRefreshResult,
} from "@/lib/server/session-refresh";
import { readUpstreamFlowCookie } from "@/lib/server/flow-cookie";
import { buildPrivateAvatarResponse } from "@/lib/server/backend-image-response";
import { prepareBackendRequestBody } from "@/lib/server/backend-request";
import { applyProxyResponseCookies } from "@/lib/server/proxy-response-cookies";

const JSON_CONTENT_TYPE = "application/json";
const REFRESH_RESULT_GRACE_MS = 10_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const refreshCoordinator = new SessionRefreshCoordinator(REFRESH_RESULT_GRACE_MS);

class RefreshServiceUnavailableError extends Error {
  constructor(readonly upstreamStatus: number) {
    super(`Refresh service unavailable (${upstreamStatus})`);
    this.name = "RefreshServiceUnavailableError";
  }
}

async function buildRefreshKey(refreshToken: string, deviceId: string): Promise<string> {
  const value = new TextEncoder().encode(`${refreshToken}:${deviceId}`);
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isJsonContentType(value: string | null): boolean {
  return Boolean(value && value.toLowerCase().includes(JSON_CONTENT_TYPE));
}

function validateMutationOrigin(request: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(request.method)) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return NextResponse.json({ detail: "Nguồn yêu cầu không hợp lệ" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const expectedHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    const expectedProtocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");

    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== expectedHost || originUrl.protocol !== `${expectedProtocol}:`) {
        return NextResponse.json({ detail: "Nguồn yêu cầu không hợp lệ" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ detail: "Nguồn yêu cầu không hợp lệ" }, { status: 403 });
    }
  }

  return null;
}

function readSessionPayload(payload: BackendResponsePayload): SessionCookiePayload | null {
  if (
    typeof payload.access_token === "string" &&
    payload.access_token &&
    typeof payload.refresh_token === "string" &&
    payload.refresh_token
  ) {
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    };
  }

  return null;
}

function buildForwardHeaders(
  request: NextRequest,
  accessToken: string | null,
  flowSessionToken: string | null,
): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const userAgent = request.headers.get("user-agent");
  const secChUaMobile = request.headers.get("sec-ch-ua-mobile");
  const ifNoneMatch = request.headers.get("if-none-match");
  const deviceId = request.headers.get("x-tpro-device-id") ?? request.cookies.get(DEVICE_ID_COOKIE_KEY)?.value ?? null;

  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (accept) {
    headers.set("Accept", accept);
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }
  if (secChUaMobile) {
    headers.set("sec-ch-ua-mobile", secChUaMobile);
  }
  if (ifNoneMatch) {
    headers.set("If-None-Match", ifNoneMatch);
  }
  if (deviceId) {
    headers.set("X-TPRO-Device-Id", deviceId);
  }
  if (flowSessionToken) {
    // The backend owns the opaque pre-auth session. Forward this one
    // allowlisted cookie only; never proxy the browser's complete Cookie header.
    headers.set("Cookie", `${FLOW_SESSION_COOKIE_KEY}=${flowSessionToken}`);
  }

  return headers;
}

function buildProxyErrorResponse(error: unknown): NextResponse {
  const isTimeout =
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError");
  const detail = isTimeout
    ? "Máy chủ phản hồi quá lâu. Hãy thử lại."
    : "Không kết nối được máy chủ.";

  return NextResponse.json(
    { detail },
    {
      status: isTimeout ? 504 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function fetchBackend(
  path: string,
  request: NextRequest,
  accessToken: string | null,
  rawBody: string,
  refreshToken: string | null,
  passwordResetToken: string | null,
  flowSessionToken: string | null,
) {
  const body = prepareBackendRequestBody(
    rawBody,
    path,
    refreshToken,
    passwordResetToken,
  );
  const headers = buildForwardHeaders(request, accessToken, flowSessionToken);
  if (body && !headers.has("Content-Type")) {
    headers.set("Content-Type", JSON_CONTENT_TYPE);
  }
  return fetch(buildBackendUrl(path, request.nextUrl.search), {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

async function refreshSession(
  request: NextRequest,
  refreshToken: string,
): Promise<SessionRefreshResult> {
  const requestDeviceId =
    request.headers.get("x-tpro-device-id") ??
    request.cookies.get(DEVICE_ID_COOKIE_KEY)?.value ??
    "";
  const refreshKey = await buildRefreshKey(refreshToken, requestDeviceId);
  return refreshCoordinator.run(refreshKey, async () => {
    const response = await fetch(`${getBackendBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: {
        Accept: JSON_CONTENT_TYPE,
        "Content-Type": JSON_CONTENT_TYPE,
        ...(request.headers.get("user-agent")
          ? { "User-Agent": request.headers.get("user-agent") as string }
          : {}),
        ...(request.headers.get("sec-ch-ua-mobile")
          ? { "sec-ch-ua-mobile": request.headers.get("sec-ch-ua-mobile") as string }
          : {}),
        ...((request.headers.get("x-tpro-device-id") ??
          request.cookies.get(DEVICE_ID_COOKIE_KEY)?.value)
          ? {
              "X-TPRO-Device-Id":
                (request.headers.get("x-tpro-device-id") ??
                  request.cookies.get(DEVICE_ID_COOKIE_KEY)?.value) as string,
            }
          : {}),
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
      return { kind: "invalid" };
    }
    if (!response.ok) {
      throw new RefreshServiceUnavailableError(response.status);
    }

    const payload = (await response.json()) as BackendResponsePayload;
    const session = readSessionPayload(payload);
    if (!session) {
      throw new RefreshServiceUnavailableError(502);
    }
    return { kind: "refreshed", session };
  });
}

async function toNextResponse(
  backendResponse: Response,
  options: {
    deviceId?: string | null;
    privateResponse: boolean;
    refreshedSession?: SessionCookiePayload | null;
    clearCookies?: boolean;
    clearFlowSession?: boolean;
    clearPasswordReset?: boolean;
    binaryResponse: boolean;
  },
): Promise<NextResponse> {
  const contentType = backendResponse.headers.get("content-type");
  const flowCookieMutation = readUpstreamFlowCookie(backendResponse.headers);

  const finalizeResponse = (
    response: NextResponse,
    responseOptions: {
      passwordResetToken?: string | null;
      passwordResetMaxAge?: number;
      session?: SessionCookiePayload | null;
    } = {},
  ) => {
    applyProxyResponseCookies(response, {
      session: responseOptions.session ?? options.refreshedSession,
      deviceId: options.deviceId,
      clearSession: options.clearCookies,
      passwordReset: responseOptions.passwordResetToken
        ? {
            token: responseOptions.passwordResetToken,
            maxAge: responseOptions.passwordResetMaxAge,
          }
        : null,
      clearPasswordReset: options.clearPasswordReset,
      flowMutation: flowCookieMutation,
      clearFlow: options.clearFlowSession,
    });
    return response;
  };

  if (options.binaryResponse && !isJsonContentType(contentType)) {
    try {
      const privateAvatarResponse = buildPrivateAvatarResponse(backendResponse);
      const response = new NextResponse(privateAvatarResponse.body, {
        status: privateAvatarResponse.status,
        headers: privateAvatarResponse.headers,
      });
      return finalizeResponse(response);
    } catch {
      return finalizeResponse(
        NextResponse.json(
          { detail: "Phản hồi avatar không hợp lệ." },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
  }

  if (isJsonContentType(contentType)) {
    const payload = (await backendResponse.json()) as unknown;
    const objectPayload = isBackendResponsePayload(payload) ? payload : null;
    const passwordResetToken =
      typeof objectPayload?.reset_token === "string" && objectPayload.reset_token
        ? objectPayload.reset_token
        : null;
    const passwordResetMaxAge =
      typeof objectPayload?.reset_token_expires_in_seconds === "number" &&
      objectPayload.reset_token_expires_in_seconds > 0
        ? objectPayload.reset_token_expires_in_seconds
        : undefined;
    const sessionPayload =
      (objectPayload ? readSessionPayload(objectPayload) : null) ?? options.refreshedSession ?? null;
    const responseBody = sanitizeBackendResponsePayload(payload);
    const response = NextResponse.json(responseBody, { status: backendResponse.status });

    if (options.privateResponse) {
      response.headers.set("Cache-Control", "no-store");
    }
    return finalizeResponse(response, {
      passwordResetToken,
      passwordResetMaxAge,
      session: sessionPayload,
    });
  }

  const text = await backendResponse.text();
  const response = new NextResponse(text, {
    status: backendResponse.status,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if (options.privateResponse) {
    response.headers.set("Cache-Control", "no-store");
  }
  return finalizeResponse(response);
}

async function handleProxy(request: NextRequest, context: RouteContext) {
  const originError = validateMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const [{ path: pathSegments }, cookieStore] = await Promise.all([
    context.params,
    cookies(),
  ]);
  const path = pathSegments.join("/");
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_KEY)?.value ?? null;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE_KEY)?.value ?? null;
  const passwordResetToken =
    cookieStore.get(PASSWORD_RESET_COOKIE_KEY)?.value ?? null;
  const flowSessionToken = cookieStore.get(FLOW_SESSION_COOKIE_KEY)?.value ?? null;
  const requestDeviceId =
    request.headers.get("x-tpro-device-id") ?? cookieStore.get(DEVICE_ID_COOKIE_KEY)?.value ?? null;
  const isPublicPath = isPublicAuthProxyPath(path);
  const usesFlowSession = usesFlowSessionProxyPath(path);
  const isRefreshRoute = path === "auth/refresh";
  const rawBody =
    request.method === "GET" || request.method === "HEAD" ? "" : await request.text();

  let backendResponse: Response;
  try {
    backendResponse = await fetchBackend(
      path,
      request,
      isPublicPath ? null : accessToken,
      rawBody,
      refreshToken,
      passwordResetToken,
      usesFlowSession ? flowSessionToken : null,
    );
  } catch (error) {
    const response = buildProxyErrorResponse(error);
    if (path === "auth/logout") {
      return applyProxyResponseCookies(response, {
        clearSession: true,
        clearPasswordReset: true,
        clearFlow: true,
      });
    }
    return response;
  }

  let refreshedSession: SessionCookiePayload | null = null;
  let clearCookies = false;

  if (!isPublicPath && !isRefreshRoute && backendResponse.status === 401 && refreshToken) {
    try {
      const refreshResult = await refreshSession(request, refreshToken);
      if (refreshResult.kind === "refreshed") {
        refreshedSession = refreshResult.session;
      } else {
        clearCookies = true;
      }
    } catch (error) {
      if (error instanceof RefreshServiceUnavailableError) {
        console.warn("Authentication refresh is temporarily unavailable", {
          upstreamStatus: error.upstreamStatus,
        });
        const response = NextResponse.json(
          { detail: "Dịch vụ xác thực đang tạm thời gián đoạn. Hãy thử lại." },
          { status: 503 },
        );
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("Retry-After", "2");
        return response;
      }
      return buildProxyErrorResponse(error);
    }
    if (refreshedSession) {
      try {
        backendResponse = await fetchBackend(
          path,
          request,
          refreshedSession.access_token,
          rawBody,
          refreshedSession.refresh_token,
          passwordResetToken,
          usesFlowSession ? flowSessionToken : null,
        );
      } catch (error) {
        return applyProxyResponseCookies(buildProxyErrorResponse(error), {
          session: refreshedSession,
          deviceId: requestDeviceId,
        });
      }
    }
  }

  if (path === "auth/logout") {
    clearCookies = true;
  }
  if (path === "auth/password/reset/complete" && backendResponse.ok) {
    clearCookies = true;
  }

  return toNextResponse(backendResponse, {
    binaryResponse: path.startsWith("auth/avatars/"),
    clearCookies,
    clearFlowSession: path === "auth/logout",
    clearPasswordReset:
      path === "auth/logout" ||
      (path === "auth/password/reset/complete" && backendResponse.ok),
    deviceId: requestDeviceId,
    // Authentication and business responses may contain private information;
    // the browser/proxies must never cache either category.
    privateResponse: true,
    refreshedSession,
  });
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PATCH = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
