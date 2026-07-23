export type BackendResponsePayload = {
  access_token?: string;
  code_verifier?: string;
  flow_token?: string;
  provider_refresh_token?: string;
  provider_token?: string;
  refresh_token?: string;
  reset_token?: string;
  [key: string]: unknown;
};

export function isBackendResponsePayload(value: unknown): value is BackendResponsePayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeBackendResponsePayload(payload: unknown): unknown {
  if (!isBackendResponsePayload(payload)) {
    return payload;
  }

  const sanitized = { ...payload };
  delete sanitized.access_token;
  delete sanitized.code_verifier;
  delete sanitized.flow_token;
  delete sanitized.provider_refresh_token;
  delete sanitized.provider_token;
  delete sanitized.refresh_token;
  delete sanitized.reset_token;
  return sanitized;
}
