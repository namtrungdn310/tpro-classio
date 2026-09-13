import assert from "node:assert/strict";
import test from "node:test";
import { isDefinitiveSuspensionRejection } from "../src/lib/api/suspension-command-recovery";

for (const status of [400, 404, 409, 422]) {
  test(`suspension application rejection ${status} permits a new preview`, () => {
    assert.equal(isDefinitiveSuspensionRejection({ isAxiosError: true, response: { status } }), true);
  });
}
for (const status of [401, 403, 408, 429, 500, 502, 503, 504]) {
  test(`suspension ambiguous response ${status} retains the same command`, () => {
    assert.equal(isDefinitiveSuspensionRejection({ isAxiosError: true, response: { status } }), false);
  });
}
test("suspension lost or invalid response retains the same command", () => {
  assert.equal(isDefinitiveSuspensionRejection({ isAxiosError: true }), false);
  assert.equal(isDefinitiveSuspensionRejection(new Error("Invalid server payload")), false);
});
