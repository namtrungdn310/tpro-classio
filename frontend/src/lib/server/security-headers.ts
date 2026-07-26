const NONCE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

export function createRequestNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function buildContentSecurityPolicy(
  nonce: string,
  nodeEnvironment: string | undefined,
): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new TypeError("Invalid CSP nonce");
  }

  const developmentDirectives =
    nodeEnvironment === "development" ? " 'unsafe-eval'" : "";
  const developmentConnections =
    nodeEnvironment === "development" ? " ws: wss:" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentDirectives}`,
    `connect-src 'self'${developmentConnections}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}
