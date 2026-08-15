import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveCaretCssLength,
  resolveSingleLineTextOffset,
  snapCaretCoordinate,
  snapCaretLength,
  supportsUnifiedCaret,
} from "../src/lib/forms/unified-caret";

test("caret coordinates and lengths stay on the physical-pixel grid", () => {
  for (const ratio of [1, 1.25, 1.5, 2]) {
    const coordinate = snapCaretCoordinate(123.37, ratio);
    const width = snapCaretLength(1, ratio);
    const height = snapCaretLength(20, ratio);

    assert.ok(isEffectivelyInteger(coordinate * ratio));
    assert.ok(isEffectivelyInteger(width * ratio));
    assert.ok(isEffectivelyInteger(height * ratio));
    assert.ok(width > 0);
  }
});

test("caret CSS lengths preserve px, rem, and em units", () => {
  const fontSizes = {
    elementFontSize: 15,
    rootFontSize: 16,
  };

  assert.equal(resolveCaretCssLength("20px", fontSizes), 20);
  assert.equal(resolveCaretCssLength("1.25rem", fontSizes), 20);
  assert.equal(resolveCaretCssLength("1.5rem", fontSizes), 24);
  assert.equal(resolveCaretCssLength("1em", fontSizes), 15);
  assert.equal(resolveCaretCssLength("1.6", fontSizes), 1.6);
  assert.equal(resolveCaretCssLength("var(--unknown)", fontSizes), 0);
});

test("caret eligibility includes measurable text controls only", () => {
  for (const type of ["text", "search", "tel", "url", "password"]) {
    assert.equal(
      supportsUnifiedCaret({ tagName: "input", type }),
      true,
      `${type} should use the unified caret`,
    );
  }

  assert.equal(supportsUnifiedCaret({ tagName: "textarea" }), true);
  assert.equal(
    supportsUnifiedCaret({
      tagName: "div",
      contentEditable: "true",
    }),
    true,
  );

  for (const type of [
    "checkbox",
    "color",
    "date",
    "email",
    "file",
    "hidden",
    "number",
    "radio",
    "range",
  ]) {
    assert.equal(
      supportsUnifiedCaret({ tagName: "input", type }),
      false,
      `${type} should retain native browser behavior`,
    );
  }

  assert.equal(
    supportsUnifiedCaret({
      tagName: "input",
      type: "text",
      readOnly: true,
    }),
    false,
  );
  assert.equal(
    supportsUnifiedCaret({
      tagName: "textarea",
      disabled: true,
    }),
    false,
  );
});

test("single-line caret origin follows text alignment and direction", () => {
  const common = {
    contentWidth: 100,
    direction: "ltr",
    textWidth: 40,
  };

  assert.equal(
    resolveSingleLineTextOffset({ ...common, textAlign: "left" }),
    0,
  );
  assert.equal(
    resolveSingleLineTextOffset({ ...common, textAlign: "center" }),
    30,
  );
  assert.equal(
    resolveSingleLineTextOffset({ ...common, textAlign: "right" }),
    60,
  );
  assert.equal(
    resolveSingleLineTextOffset({ ...common, textAlign: "end" }),
    60,
  );
  assert.equal(
    resolveSingleLineTextOffset({
      ...common,
      direction: "rtl",
      textAlign: "start",
    }),
    60,
  );
});

test("frontend text controls do not introduce selection-incompatible input types", () => {
  const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
  const unsupportedTypePattern =
    /type="(?:date|datetime-local|email|month|number|time|week)"/;

  for (const filePath of findTsxFiles(sourceRoot)) {
    const source = readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      source,
      unsupportedTypePattern,
      `${filePath} must use a measurable text input plus inputMode, or explicitly retain native caret behavior`,
    );
  }
});

function findTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTsxFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".tsx") ? [entryPath] : [];
  });
}

function isEffectivelyInteger(value: number) {
  return Math.abs(value - Math.round(value)) < 1e-9;
}
