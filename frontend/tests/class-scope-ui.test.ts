import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/classes/page.tsx", import.meta.url),
  "utf8",
);
const tableSource = readFileSync(
  new URL("../src/components/classes/classes-table.tsx", import.meta.url),
  "utf8",
);

test("class navigation exposes only real lifecycle states", () => {
  assert.doesNotMatch(pageSource, /needs_complete|Cần hoàn tất/);
  assert.doesNotMatch(tableSource, /LegacyClassesTable|Cần hoàn tất/);
  assert.match(pageSource, /Đang hoạt động/);
  assert.match(pageSource, /Sắp mở/);
  assert.match(pageSource, /Đã ngừng/);
  assert.match(pageSource, /Đã hủy/);
});
