import assert from "node:assert/strict";
import test from "node:test";
import {
  isLoopbackPublicOrigin,
  normalizePublicAppOrigin,
} from "../src/lib/server/public-origin";

test("public application origin is canonicalized without trusting proxy headers", () => {
  assert.equal(
    normalizePublicAppOrigin(" https://classio.example.com/ "),
    "https://classio.example.com",
  );
  assert.equal(normalizePublicAppOrigin(undefined), null);
});

test("public application origin rejects ambiguous or credential-bearing values", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://user:password@classio.example.com",
    "https://classio.example.com/app",
    "https://classio.example.com?next=evil",
    "//classio.example.com",
  ]) {
    assert.throws(() => normalizePublicAppOrigin(value), /APP_ORIGIN/);
  }
});

test("insecure cookies are eligible only for exact loopback origins", () => {
  assert.equal(isLoopbackPublicOrigin("http://localhost:3000"), true);
  assert.equal(isLoopbackPublicOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isLoopbackPublicOrigin("http://[::1]:3000"), true);
  assert.equal(isLoopbackPublicOrigin("https://staging.example.com"), false);
  assert.equal(isLoopbackPublicOrigin("http://localhost.example.com"), false);
});
