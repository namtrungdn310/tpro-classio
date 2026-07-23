import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FEE_TEMPLATE_CARET_BOUNDARY,
  stripFeeTemplateCaretBoundaries,
} from "../src/lib/fees/editor-caret-boundary";

const editorSource = readFileSync(
  new URL("../src/components/fees/fee-template-editor.tsx", import.meta.url),
  "utf8",
);

test("DOM-only caret boundaries never leak into a saved Zalo template", () => {
  assert.equal(
    stripFeeTemplateCaretBoundaries(
      `{{ten_hoc_vien}}${FEE_TEMPLATE_CARET_BOUNDARY}: nội dung${FEE_TEMPLATE_CARET_BOUNDARY}`,
    ),
    "{{ten_hoc_vien}}: nội dung",
  );
});

test("atomic Zalo tokens render with an editable text caret boundary", () => {
  assert.match(
    editorSource,
    /createTokenChip\(segment\.value, segment\.label\),\s*createTokenCaretBoundary\(\)/,
  );
  assert.match(
    editorSource,
    /range\.setStart\(boundary, FEE_TEMPLATE_CARET_BOUNDARY\.length\)/,
  );
});

test("Zalo editor inherits the shared input caret and native selection styling", () => {
  assert.match(editorSource, /className="form-input-text /);
  assert.doesNotMatch(editorSource, /selection:bg-|caret-gray-/);
});
