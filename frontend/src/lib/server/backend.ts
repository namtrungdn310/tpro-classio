const DEFAULT_INTERNAL_BACKEND_URL = "http://localhost:8000";

const PUBLIC_AUTH_PROXY_PATHS = new Set([
  "auth/login",
  "auth/register",
  "auth/register/resend",
  "auth/register/verify",
  "auth/login/totp/verify",
  "auth/login/recovery/verify",
  "auth/onboarding/google/start",
  "auth/onboarding/totp/enroll",
  "auth/onboarding/totp/verify",
  "auth/onboarding/recovery-codes",
  "auth/onboarding/recovery/confirm",
  "auth/password/reset/start",
  "auth/password/reset/verify-otp",
  "auth/password/reset/complete",
]);

const FLOW_SESSION_PROXY_PATHS = new Set([
  "auth/login/totp/verify",
  "auth/login/recovery/verify",
  "auth/onboarding/google/start",
  "auth/onboarding/totp/enroll",
  "auth/onboarding/totp/verify",
  "auth/onboarding/recovery-codes",
  "auth/onboarding/recovery/confirm",
]);

export function getBackendBaseUrl(): string {
  const internalUrl = (process.env.NEXT_INTERNAL_API_URL ?? DEFAULT_INTERNAL_BACKEND_URL).replace(
    /\/$/,
    "",
  );

  return internalUrl;
}

export function buildBackendUrl(path: string, search: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getBackendBaseUrl()}${normalizedPath}${search}`;
}

export function isPublicAuthProxyPath(path: string): boolean {
  return PUBLIC_AUTH_PROXY_PATHS.has(path);
}

export function usesFlowSessionProxyPath(path: string): boolean {
  return FLOW_SESSION_PROXY_PATHS.has(path);
}
