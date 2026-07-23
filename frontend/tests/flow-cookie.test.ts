import assert from "node:assert/strict";
import test from "node:test";
import { readUpstreamFlowCookie } from "../src/lib/server/flow-cookie";

test("BFF extracts the allowlisted opaque pre-auth cookie", () => {
  const opaqueToken = "a".repeat(43);
  const headers = new Headers({
    "set-cookie":
      `tpro_flow_session=${opaqueToken}; HttpOnly; Max-Age=300; Path=/; SameSite=lax; Secure`,
  });

  assert.deepEqual(readUpstreamFlowCookie(headers), {
    value: opaqueToken,
    maxAge: 300,
    clear: false,
  });
});

test("BFF recognizes an upstream flow-cookie deletion", () => {
  const headers = new Headers({
    "set-cookie":
      'tpro_flow_session=""; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/',
  });

  assert.deepEqual(readUpstreamFlowCookie(headers), {
    value: "",
    maxAge: 0,
    clear: true,
  });
});

test("BFF ignores every upstream cookie outside the flow-cookie allowlist", () => {
  const headers = new Headers({
    "set-cookie": "supabase_session=must-not-cross-bff; HttpOnly; Path=/",
  });

  assert.equal(readUpstreamFlowCookie(headers), null);
});

test("BFF rejects malformed flow-cookie values and caps their lifetime", () => {
  const malformedHeaders = new Headers({
    "set-cookie": "tpro_flow_session=bad%0D%0Avalue; HttpOnly; Max-Age=300; Path=/",
  });
  assert.equal(readUpstreamFlowCookie(malformedHeaders), null);

  const validToken = "a".repeat(43);
  const longLifetimeHeaders = new Headers({
    "set-cookie": `tpro_flow_session=${validToken}; HttpOnly; Max-Age=86400; Path=/`,
  });
  assert.deepEqual(readUpstreamFlowCookie(longLifetimeHeaders), {
    value: validToken,
    maxAge: 900,
    clear: false,
  });

  const oversizedHeaders = new Headers({
    "set-cookie": `tpro_flow_session=${"a".repeat(129)}; HttpOnly; Max-Age=300; Path=/`,
  });
  assert.equal(readUpstreamFlowCookie(oversizedHeaders), null);
});
