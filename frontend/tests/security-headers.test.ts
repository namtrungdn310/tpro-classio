import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContentSecurityPolicy,
  createRequestNonce,
} from "../src/lib/server/security-headers";

test("production CSP uses a per-request nonce without allowing inline scripts", () => {
  const nonce = createRequestNonce();
  const policy = buildContentSecurityPolicy(nonce, "production");

  assert.match(policy, new RegExp(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`));
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("development CSP allows only the tooling capabilities needed by Next dev", () => {
  const policy = buildContentSecurityPolicy(createRequestNonce(), "development");

  assert.match(policy, /script-src[^;]*'unsafe-eval'/);
  assert.match(policy, /connect-src 'self' ws: wss:/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});

test("CSP rejects a caller-supplied malformed nonce", () => {
  assert.throws(
    () => buildContentSecurityPolicy("bad nonce", "production"),
    /Invalid CSP nonce/,
  );
});
