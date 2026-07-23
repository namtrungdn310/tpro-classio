import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/components/layout/header-filter-controls.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("header filter layout measurement depends on stable filter content", () => {
  assert.match(source, /const visibleFilterLayoutKey = visibleFilters/);
  assert.match(
    source,
    /\[isOpen, visibleFilterLayoutKey, visibleFilters\.length\]/,
  );
  assert.doesNotMatch(source, /\[isOpen, visibleFilters\]/);
});

test("header filter avoids scheduling a duplicate width update", () => {
  assert.match(
    source,
    /currentWidth === nextWidth \? currentWidth : nextWidth/,
  );
});

test("header searches use the shared input typography and caret contract", () => {
  assert.match(source, /formTextControlHeaderClassName/);
  assert.match(source, /className=\{formTextControlHeaderClassName\}/);
  assert.doesNotMatch(source, /placeholder:text-\[15px\]|\btext-\[15px\]/);
});
