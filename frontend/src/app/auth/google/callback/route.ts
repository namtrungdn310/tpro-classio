import { NextRequest, NextResponse } from "next/server";
import { FLOW_SESSION_COOKIE_KEY } from "@/lib/auth/session";
import {
  applyFlowSessionCookie,
  clearFlowSessionCookie,
} from "@/lib/server/auth-cookies";
import { buildBackendUrl } from "@/lib/server/backend";
import { readUpstreamFlowCookie } from "@/lib/server/flow-cookie";

const CALLBACK_TIMEOUT_MS = 15_000;
const UNSAFE_BROWSER_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const DEFAULT_PUBLIC_APP_ORIGIN = "http://localhost:3000";

function readRequestHost(request: NextRequest): string | null {
  return request.headers.get("host")?.split(",", 1)[0]?.trim() || null;
}

function readHostname(host: string): string {
  if (host.startsWith("[")) {
    return host.slice(0, host.indexOf("]") + 1);
  }
  return host.split(":", 1)[0] || host;
}

function buildSafeRequestUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      const origin = new URL(configuredOrigin);
      if (
        ["http:", "https:"].includes(origin.protocol) &&
        !origin.pathname.replaceAll("/", "") &&
        !origin.search &&
        !origin.hash &&
        !origin.username &&
        !origin.password
      ) {
        url.protocol = origin.protocol;
        url.host = origin.host;
        return url;
      }
    } catch {
      // Fall back to the request host normalization below.
    }
  }

  const host = readRequestHost(request);
  if (host) {
    const hostname = readHostname(host);
    if (UNSAFE_BROWSER_HOSTS.has(hostname)) {
      url.host = host.replace(hostname, "localhost");
    } else {
      url.host = host;
    }
  } else if (UNSAFE_BROWSER_HOSTS.has(url.hostname)) {
    const origin = new URL(DEFAULT_PUBLIC_APP_ORIGIN);
    url.protocol = origin.protocol;
    url.host = origin.host;
  }
  return url;
}

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const target = new URL(pathname, buildSafeRequestUrl(request));
  target.search = search;
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function readBackendErrorDetail(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const payload = (await response.clone().json()) as unknown;
    if (payload && typeof payload === "object" && "detail" in payload) {
      const detail = payload.detail;
      if (typeof detail === "string") {
        return detail.trim().slice(0, 180) || null;
      }
      if (Array.isArray(detail)) {
        const firstMessage = detail.find((item) => {
          return (
            item &&
            typeof item === "object" &&
            "msg" in item &&
            typeof item.msg === "string"
          );
        });
        if (
          firstMessage &&
          typeof firstMessage === "object" &&
          "msg" in firstMessage &&
          typeof firstMessage.msg === "string"
        ) {
          return firstMessage.msg.trim().slice(0, 180) || null;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildGoogleErrorSearch(detail: string | null): string {
  const search = new URLSearchParams({ error: "oauth_failed" });
  if (detail) {
    search.set("detail", detail);
  }
  return `?${search.toString()}`;
}

function applyUpstreamFlowCookie(response: NextResponse, backendResponse: Response) {
  const mutation = readUpstreamFlowCookie(backendResponse.headers);
  if (!mutation) return;

  if (mutation.clear) {
    clearFlowSessionCookie(response);
  } else {
    applyFlowSessionCookie(response, mutation.value, mutation.maxAge);
  }
}

export async function GET(request: NextRequest) {
  const flowSessionToken = request.cookies.get(FLOW_SESSION_COOKIE_KEY)?.value;
  if (!flowSessionToken) {
    return redirectTo(request, "/login", "?reason=flow-expired");
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(
      buildBackendUrl("auth/onboarding/google/callback", request.nextUrl.search),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: `${FLOW_SESSION_COOKIE_KEY}=${flowSessionToken}`,
          ...(request.headers.get("user-agent")
            ? { "User-Agent": request.headers.get("user-agent") as string }
            : {}),
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      },
    );
  } catch (error) {
    console.warn("Google onboarding callback request failed", error);
    return redirectTo(
      request,
      "/onboarding/google",
      buildGoogleErrorSearch("Không kết nối được máy chủ xác thực. Vui lòng thử lại."),
    );
  }

  const location = backendResponse.headers.get("location");
  if (backendResponse.status >= 300 && backendResponse.status < 400 && location) {
    const upstreamTarget = new URL(location, request.url);
    // Ignore the upstream origin entirely. Only this exact same-origin page is
    // a valid post-OAuth destination, which closes an open-redirect vector.
    if (upstreamTarget.pathname === "/onboarding/totp") {
      const response = redirectTo(request, upstreamTarget.pathname, upstreamTarget.search);
      applyUpstreamFlowCookie(response, backendResponse);
      return response;
    }
  }

  const errorDetail = await readBackendErrorDetail(backendResponse);
  console.warn("Google onboarding callback rejected", {
    status: backendResponse.status,
    detail: errorDetail,
  });
  const response = redirectTo(
    request,
    "/onboarding/google",
    buildGoogleErrorSearch(errorDetail),
  );
  applyUpstreamFlowCookie(response, backendResponse);
  return response;
}
