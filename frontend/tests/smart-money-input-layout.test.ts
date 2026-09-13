import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/ui/smart-money-input.tsx", import.meta.url),
  "utf8",
);

test("smart money preview is vertically centered inside the shared input", () => {
  assert.match(
    source,
    /form-input-text pointer-events-none absolute top-1\/2 -translate-y-1\/2 select-none font-normal text-gray-400/,
  );
  assert.doesNotMatch(source, /text-sm leading-none text-gray-400/);
});
