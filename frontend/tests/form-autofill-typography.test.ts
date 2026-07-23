import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("shared form controls keep the same typography during browser autofill", () => {
  assert.match(globalStyles, /--form-caret-color: #4b5563/);
  assert.match(
    globalStyles,
    /:where\(input, textarea, \[contenteditable="true"\]\)\s*\{[\s\S]*?caret-color: var\(--form-caret-color\)/,
  );
  assert.match(globalStyles, /\.form-input-text\s*\{[\s\S]*?--form-input-font-family:/);
  assert.match(globalStyles, /\.form-input-text:-webkit-autofill\s*\{/);
  assert.match(globalStyles, /\.form-input-text:autofill\s*\{/);
  assert.match(
    globalStyles,
    /font-family: var\(--form-input-font-family\) !important;/,
  );
  assert.match(
    globalStyles,
    /font-size: var\(--form-input-font-size\) !important;/,
  );
  assert.match(
    globalStyles,
    /font-weight: var\(--form-input-font-weight\) !important;/,
  );
  assert.equal(
    globalStyles.match(/caret-color: var\(--form-caret-color\)/g)?.length,
    1,
  );
});

test("settings reveal releases its composited transform after the animation", () => {
  assert.match(globalStyles, /@keyframes settings-reveal[\s\S]*?to\s*\{[\s\S]*?transform: none;/);
  assert.match(globalStyles, /\.settings-reveal\s*\{\s*animation: settings-reveal 160ms ease-out;\s*\}/);
  assert.doesNotMatch(globalStyles, /animation: settings-reveal[^;]*\bboth\b/);
});

test("password controls override shared typography through the same tokens", () => {
  assert.match(
    globalStyles,
    /\.password-input-native\s*\{[\s\S]*?--form-input-font-weight: 700;/,
  );
  assert.match(
    globalStyles,
    /\.password-input-native\s*\{[\s\S]*?--form-input-letter-spacing: 0\.12em;/,
  );
});
