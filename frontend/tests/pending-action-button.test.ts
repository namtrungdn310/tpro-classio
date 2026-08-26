import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/ui/pending-action-button.tsx", import.meta.url),
  "utf8",
);

test("pending action button disables itself while pending and exposes aria-busy", () => {
  assert.match(source, /disabled=\{disabled \|\| isPending\}/);
  assert.match(source, /aria-busy=\{isPending \|\| undefined\}/);
});

test("pending action button hugs its content and swaps to the pending label", () => {
  // No fixed-footprint anchor: the button width follows the current label so
  // "Lưu" stays tight and "Đang lưu" expands naturally.
  assert.doesNotMatch(source, /col-start-1 row-start-1/);
  assert.doesNotMatch(source, /invisible/);
  assert.match(source, /isPending \? \(\s*<LoadingLabel label=\{pendingLabel\} \/>/);
  assert.match(source, /whitespace-nowrap/);
});

test("pending action button does not apply global spinner overlays", () => {
  assert.doesNotMatch(source, /animate-spin/);
  assert.doesNotMatch(source, /absolute inset-0/);
});