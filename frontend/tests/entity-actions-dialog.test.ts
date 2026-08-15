import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/shared/entity-actions-dialog.tsx", import.meta.url),
  "utf8",
);

test("choosing an action does not close the dialog from inside (the page hides it while the action dialog is open)", () => {
  assert.match(source, /onClick=\{action\.onClick\}/);
  assert.doesNotMatch(source, /requestClose\(\);[\s\S]*action\.onClick\(\)/);
  assert.doesNotMatch(source, /action\.onClick\(\);[\s\S]*requestClose\(\)/);
});

test("backdrop blocks outside interaction and closes the dialog on outside click", () => {
  assert.match(source, /backdropPointerDownRef\.current = event\.target === event\.currentTarget/);
  assert.match(source, /backdropPointerDownRef\.current && event\.target === event\.currentTarget[\s\S]*requestClose\(\)/);
  assert.doesNotMatch(source, /pointer-events-none fixed inset-0/);
});

test("dialog has no stacking or suspension state — it simply closes and reopens via the page", () => {
  assert.doesNotMatch(source, /suspended/);
  assert.doesNotMatch(source, /scale-\[0\.97\]|bg-black\/50/);
});
