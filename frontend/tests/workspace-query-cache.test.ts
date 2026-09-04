import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const authProvider = fs.readFileSync(
  path.join(root, "src/lib/hooks/useAuth.tsx"),
  "utf8",
);
const authApi = fs.readFileSync(path.join(root, "src/lib/api/auth.ts"), "utf8");
const tokenSession = fs.readFileSync(
  path.join(root, "src/lib/auth/session.ts"),
  "utf8",
);

test("business query cache is cleared when the same user moves workspace", () => {
  assert.match(authProvider, /previousUser\.workspace_id !== currentUser\.workspace_id/);
  assert.match(authProvider, /queryClient\.clear\(\)/);
  assert.match(authProvider, /currentPrincipalRef\.current = currentUser/);
});

test("workspace identity is carried by both me response and access token", () => {
  assert.match(authApi, /workspace_id: z\.string\(\)\.uuid\(\)/);
  assert.match(tokenSession, /workspace_id\?: string/);
  assert.match(tokenSession, /workspace_id: payload\.workspace_id/);
});
