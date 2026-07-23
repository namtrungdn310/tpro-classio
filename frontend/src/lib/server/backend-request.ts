type JsonPayload = Record<string, unknown>;

function parseObjectBody(rawBody: string): JsonPayload {
  if (!rawBody) return {};
  const parsed = JSON.parse(rawBody) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a JSON object request body");
  }
  return parsed as JsonPayload;
}

function setServerSecret(
  payload: JsonPayload,
  key: "refresh_token" | "reset_token",
  value: string | null,
): void {
  if (value) payload[key] = value;
  else delete payload[key];
}

/**
 * Add server-held credentials only at the BFF boundary. A browser-provided
 * value is always replaced or removed, so refresh/reset handles never become
 * part of the public API contract.
 */
export function prepareBackendRequestBody(
  rawBody: string,
  path: string,
  refreshToken: string | null,
  passwordResetToken: string | null,
): string | undefined {
  if (path === "auth/logout") {
    const payload = parseObjectBody(rawBody);
    setServerSecret(payload, "refresh_token", refreshToken);
    return JSON.stringify(payload);
  }

  if (!rawBody) return undefined;

  if (path === "auth/password/reset/complete") {
    const payload = parseObjectBody(rawBody);
    setServerSecret(payload, "reset_token", passwordResetToken);
    return JSON.stringify(payload);
  }

  return rawBody;
}
