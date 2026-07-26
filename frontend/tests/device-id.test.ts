import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeDeviceId } from "../src/lib/auth/device";

test("device identifiers use the same closed format as the backend", () => {
  assert.equal(normalizeDeviceId("0123456789abcdef"), "0123456789abcdef");
  assert.equal(normalizeDeviceId(" device_identifier_123456 "), "device_identifier_123456");
  assert.equal(normalizeDeviceId("short"), null);
  assert.equal(normalizeDeviceId("0123456789abcdef!"), null);
  assert.equal(normalizeDeviceId("a".repeat(129)), null);
});

test("device identifier generation never falls back to predictable randomness", () => {
  const source = readFileSync(
    new URL("../src/lib/auth/device.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /Math\.random/);
  assert.match(source, /crypto\?\.randomUUID/);
  assert.match(source, /crypto\?\.getRandomValues/);
});
