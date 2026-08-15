import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/lib/ui/click-guard.ts", import.meta.url),
  "utf8",
);

test("click guard tracks selection globally via selectionchange", () => {
  assert.match(source, /addEventListener\("selectionchange"/);
  assert.match(source, /lastActiveSelectionAt = performance\.now\(\)/);
  assert.match(source, /readHasSelection\(\)/);
});

test("click guard blocks row clicks when a selection existed at press or recently", () => {
  assert.match(source, /selectionAtPressRef\.current = readHasSelection\(\)/);
  assert.match(
    source,
    /selectionAtPressRef\.current \|\|[\s\S]*lastActiveSelectionAt < SELECTION_BLOCK_WINDOW_MS/,
  );
  assert.match(source, /if \(blockedBySelection\)[\s\S]*return/);
});

test("click guard keeps the drag threshold so selecting text by dragging never opens the dialog", () => {
  assert.match(source, /if \(moved > 4\)[\s\S]*return/);
  assert.match(source, /pressRef\.current = null/);
});
