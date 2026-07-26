import assert from "node:assert/strict";
import test from "node:test";
import { resolveSecureCookieSetting } from "../src/lib/server/auth-cookies";

test("auth cookie security can be disabled only for local HTTP Docker", () => {
  assert.equal(
    resolveSecureCookieSetting("false", "production", "http://localhost:3000"),
    false,
  );
  assert.equal(
    resolveSecureCookieSetting("0", "production", "http://127.0.0.1:3000"),
    false,
  );
  assert.equal(resolveSecureCookieSetting("false", "development"), false);
});

test("staging and production can force Secure independently from the build mode", () => {
  assert.equal(resolveSecureCookieSetting("true", "development"), true);
  assert.equal(resolveSecureCookieSetting("1", "development"), true);
});

test("auth cookies default to Secure in production when no override exists", () => {
  assert.equal(resolveSecureCookieSetting(undefined, "production"), true);
  assert.equal(resolveSecureCookieSetting(undefined, "development"), false);
});

test("an insecure-cookie override fails closed outside a loopback origin", () => {
  assert.equal(
    resolveSecureCookieSetting("false", "production", "https://staging.classio.vn"),
    true,
  );
  assert.equal(resolveSecureCookieSetting("false", "production"), true);
  assert.equal(
    resolveSecureCookieSetting("false", "production", "not-a-valid-origin"),
    true,
  );
});
