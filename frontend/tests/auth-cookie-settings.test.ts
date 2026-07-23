import assert from "node:assert/strict";
import test from "node:test";
import { resolveSecureCookieSetting } from "../src/lib/server/auth-cookies";

test("auth cookie security can be disabled explicitly for local HTTP Docker", () => {
  assert.equal(resolveSecureCookieSetting("false", "production"), false);
  assert.equal(resolveSecureCookieSetting("0", "production"), false);
});

test("staging and production can force Secure independently from the build mode", () => {
  assert.equal(resolveSecureCookieSetting("true", "development"), true);
  assert.equal(resolveSecureCookieSetting("1", "development"), true);
});

test("auth cookies default to Secure in production when no override exists", () => {
  assert.equal(resolveSecureCookieSetting(undefined, "production"), true);
  assert.equal(resolveSecureCookieSetting(undefined, "development"), false);
});
