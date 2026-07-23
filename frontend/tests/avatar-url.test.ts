import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateAvatarUrl } from "../src/lib/auth/avatar-url";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

test("avatar URLs are limited to the exact same-origin private BFF route", () => {
  assert.equal(
    isPrivateAvatarUrl(
      `/api/proxy/auth/avatars/${USER_ID}?v=0123456789abcdef`,
      USER_ID,
    ),
    true,
  );
  assert.equal(isPrivateAvatarUrl("https://lh3.googleusercontent.com/avatar", USER_ID), false);
  assert.equal(
    isPrivateAvatarUrl(
      "/api/proxy/auth/avatars/00000000-0000-0000-0000-000000000000?v=0123456789abcdef",
      USER_ID,
    ),
    false,
  );
  assert.equal(
    isPrivateAvatarUrl(`/api/proxy/auth/avatars/${USER_ID}?v=../../settings`, USER_ID),
    false,
  );
});
