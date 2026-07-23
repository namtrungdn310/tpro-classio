import assert from "node:assert/strict";
import test from "node:test";
import { prepareBackendRequestBody } from "../src/lib/server/backend-request";

test("logout receives the HttpOnly refresh token even when the browser sends an empty body", () => {
  assert.deepEqual(
    JSON.parse(prepareBackendRequestBody("", "auth/logout", "server-refresh", null) as string),
    { refresh_token: "server-refresh" },
  );
});

test("browser credential fields can never override or introduce BFF-held secrets", () => {
  assert.deepEqual(
    JSON.parse(
      prepareBackendRequestBody(
        JSON.stringify({ new_password: "Strong!123", reset_token: "browser-value" }),
        "auth/password/reset/complete",
        null,
        null,
      ) as string,
    ),
    { new_password: "Strong!123" },
  );
});
