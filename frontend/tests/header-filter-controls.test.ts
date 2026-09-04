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
const formTextControlSource = readFileSync(
  new URL("../src/components/ui/form-text-control.ts", import.meta.url),
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
  assert.match(formTextControlSource, /import \{ cn \} from "@\/lib\/utils"/);
  assert.match(formTextControlSource, /formTextControlClassName[\s\S]*select-text/);
  assert.match(formTextControlSource, /formTextControlClassName[\s\S]*py-0/);
  assert.match(formTextControlSource, /formTextControlClassName[\s\S]*placeholder:font-normal/);
  assert.match(
    formTextControlSource,
    /formTextControlHeaderClassName\s*=\s*cn\(formTextControlClassName,\s*"min-w-0 pl-7 pr-10 md:w-\[min\(20vw,260px\)\]"\)/,
  );
  assert.doesNotMatch(
    formTextControlSource,
    /formTextControlHeaderClassName\s*=\s*"form-input-text/,
  );
});

test("filter trigger stays compact inside the shared header input", () => {
  assert.match(
    source,
    /className=\{`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition/,
  );
  assert.match(source, /<SlidersHorizontal className="h-3 w-3" \/>/);
});

test("filter chips stay compact while retaining their readable label size", () => {
  assert.match(
    source,
    /className=\{`inline-flex h-7 shrink-0 items-center rounded-full border px-2\.5 text-\[11px\] font-medium leading-4 transition/,
  );
});
