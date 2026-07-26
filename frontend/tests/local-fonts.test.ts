import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);

const fontAssets = [
  "../src/app/fonts/source-sans-3/SourceSans3-400-700.woff2",
  "../src/app/fonts/be-vietnam-pro/BeVietnamPro-500.woff2",
  "../src/app/fonts/be-vietnam-pro/BeVietnamPro-600.woff2",
  "../src/app/fonts/be-vietnam-pro/BeVietnamPro-700.woff2",
  "../src/app/fonts/josefin-sans/JosefinSans-500-700.woff2",
] as const;

const fontLicenses = [
  "../src/app/fonts/source-sans-3/OFL.txt",
  "../src/app/fonts/be-vietnam-pro/OFL.txt",
  "../src/app/fonts/josefin-sans/OFL.txt",
] as const;

test("application fonts are bundled locally for reproducible offline builds", () => {
  assert.match(layout, /from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);

  for (const asset of fontAssets) {
    assert.ok(statSync(new URL(asset, import.meta.url)).size > 0);
  }
});

test("each bundled font keeps its Open Font License", () => {
  for (const license of fontLicenses) {
    assert.match(
      readFileSync(new URL(license, import.meta.url), "utf8"),
      /SIL OPEN FONT LICENSE Version 1\.1/,
    );
  }
});
