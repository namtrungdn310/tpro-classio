import axios from "axios";
import { ensureDeviceId } from "@/lib/auth/device";
import { buildSessionReplacedLoginUrl, isSessionReplacedError } from "@/lib/api/errors";
import {
  completeRequestTracking,
  startRequestTracking,
  type RequestMeta,
} from "@/lib/performance/request-tracking";

declare module "axios" {
  export interface InternalAxiosRequestConfig {
    _tproMetric?: RequestMeta;
  }
}

// Các API route liên quan đến xác thực không nên trigger global 401 redirect
function isBrowserAuthRoute(url: string): boolean {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/register") ||
    url.includes("/auth/password") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout") ||
    url.includes("/auth/me") ||
    url.includes("/auth/onboarding") ||
    url.includes("/auth/invitations")
  );
}

// Các trang (page) công khai không nên bị redirect về /login nếu có lỗi 401 bất ngờ
function isPublicPage(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/otp") ||
    pathname.startsWith("/onboarding")
  );
}

export const apiClient = axios.create({
  baseURL: "/api/proxy",
  timeout: 15_000,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const deviceId = ensureDeviceId();
    if (deviceId) {
      config.headers = config.headers ?? {};
      config.headers["X-TPRO-Device-Id"] = deviceId;
    }

    const meta = startRequestTracking(
      (config.method ?? "get").toUpperCase(),
      config.url ?? "",
    );
    config.headers = config.headers ?? {};
    config.headers["X-Request-ID"] = meta.id;
    config._tproMetric = meta;
  }

  return config;
});

function responseBytesOf(response: unknown): number | null {
  if (typeof response === "string") {
    return new Blob([response]).size;
  }
  if (response === null || response === undefined) {
    return null;
  }
  try {
    return JSON.stringify(response).length;
  } catch {
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => {
    if (typeof window !== "undefined" && response.config._tproMetric) {
      completeRequestTracking(
        response.config._tproMetric,
        response.status,
        responseBytesOf(response.data),
      );
    }
    return response;
  },
  (error) => {
    if (typeof window !== "undefined" && error.config?._tproMetric) {
      completeRequestTracking(
        error.config._tproMetric,
        error.response?.status ?? null,
        error.response ? responseBytesOf(error.response.data) : null,
        error.code ? String(error.code) : undefined,
      );
    }

    if (
      typeof window !== "undefined" &&
      isSessionReplacedError(error) &&
      !isPublicPage(window.location.pathname)
    ) {
      window.location.href = buildSessionReplacedLoginUrl();
      return Promise.reject(error);
    }

    if (
      typeof window !== "undefined" &&
      error.response?.status === 401 &&
      !isBrowserAuthRoute(error.config?.url ?? "") &&
      !isPublicPage(window.location.pathname)
    ) {
      window.location.href = "/login";
    }

    return Promise.reject(error);
  },
);
