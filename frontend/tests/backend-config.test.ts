import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBackendBaseUrl } from "../src/lib/server/backend";

test("internal backend URL accepts only a clean HTTP(S) origin", () => {
  assert.equal(
    normalizeBackendBaseUrl(" http://backend:8000/ "),
    "http://backend:8000",
  );
  assert.equal(
    normalizeBackendBaseUrl("https://api.staging.example.com"),
    "https://api.staging.example.com",
  );
});

test("internal backend URL rejects credential leakage and ambiguous URL parts", () => {
  for (const value of [
    "ftp://backend:8000",
    "http://user:password@backend:8000",
    "http://backend:8000/api",
    "http://backend:8000?redirect=https://evil.example",
    "http://backend:8000/#fragment",
    "//backend:8000",
  ]) {
    assert.throws(() => normalizeBackendBaseUrl(value), /NEXT_INTERNAL_API_URL/);
  }
});
