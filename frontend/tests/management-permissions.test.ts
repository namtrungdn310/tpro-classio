import assert from "node:assert/strict";
import test from "node:test";
import { isManagementUser } from "../src/lib/auth/permissions";

test("dev owners and admins retain management controls", () => {
  assert.equal(isManagementUser({ role: "dev", is_owner: true }), true);
  assert.equal(isManagementUser({ role: "dev", is_owner: false }), true);
  assert.equal(isManagementUser({ role: "admin", is_owner: false }), true);
});

test("teacher accounts never receive management controls", () => {
  assert.equal(isManagementUser({ role: "teacher", is_owner: false }), false);
  assert.equal(isManagementUser(null), false);
  assert.equal(isManagementUser(undefined), false);
});
