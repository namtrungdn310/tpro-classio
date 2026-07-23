import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeBackendResponsePayload } from "../src/lib/server/backend-response";

test("BFF preserves JSON list responses", () => {
  const payload = [{ id: "class-1" }, { id: "class-2" }];

  assert.deepEqual(sanitizeBackendResponsePayload(payload), payload);
});

test("BFF removes credential fields only from object responses", () => {
  const response = sanitizeBackendResponsePayload({
    access_token: "access-secret",
    code_verifier: "pkce-secret",
    flow_token: "flow-secret",
    provider_refresh_token: "provider-refresh-secret",
    provider_token: "provider-secret",
    refresh_token: "refresh-secret",
    reset_token: "reset-secret",
    user: { id: "user-1" },
  });

  assert.deepEqual(response, { user: { id: "user-1" } });
});
