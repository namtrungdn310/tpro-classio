import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookSource = readFileSync(
  new URL("../src/lib/hooks/useAsyncAction.ts", import.meta.url),
  "utf8",
);
const invalidationSource = readFileSync(
  new URL("../src/lib/query/invalidation.ts", import.meta.url),
  "utf8",
);

test("useAsyncAction guards against double submission", () => {
  assert.match(hookSource, /inFlightRef/);
  assert.match(hookSource, /if \(inFlightRef\.current\) \{[\s\S]*return;/);
  assert.match(hookSource, /setIsPending\(true\)/);
  assert.match(hookSource, /setError\(null\)/);
  assert.match(hookSource, /setIsPending\(false\)/);
});

test("useAsyncAction captures an inline error and rethrows", () => {
  assert.match(hookSource, /catch \(caught\)/);
  assert.match(hookSource, /setError\(message\)/);
  assert.match(hookSource, /throw caught/);
});

test("invalidateDomainQueries only touches the requested domains", () => {
  assert.match(invalidationSource, /classQueryKeys\.all/);
  assert.match(invalidationSource, /\["dashboard"\]/);
  assert.match(invalidationSource, /\["fees"\]/);
  assert.match(invalidationSource, /\["reports"\]/);
  assert.match(invalidationSource, /studentQueryKeys\.all/);
  assert.match(invalidationSource, /staffQueryKeys\.root/);
  assert.match(invalidationSource, /\["fee-transactions"\]/);
});
