import assert from "node:assert/strict";
import test from "node:test";
import {
  FEE_CLASS_FILTER_ROWS,
  getFeeClassCardsPerRow,
  getFeeClassMinimumCardWidth,
  getFeeClassPageColumnCount,
  getFeeClassPageCount,
  getFeeClassPageIndex,
  getFeeClassPageItems,
  getFeeClassPageSize,
} from "../src/lib/fees/class-filter-pagination";

test("class filter derives responsive capacity from its measured width", () => {
  assert.equal(FEE_CLASS_FILTER_ROWS, 3);
  assert.equal(getFeeClassCardsPerRow(360), 2);
  assert.equal(getFeeClassCardsPerRow(720), 4);
  assert.equal(getFeeClassCardsPerRow(1_100), 6);
  assert.equal(getFeeClassCardsPerRow(2_000), 6);
  assert.equal(getFeeClassPageSize(4), 12);
});

test("class filter reserves enough card width for complete class names", () => {
  const minimumWidth = getFeeClassMinimumCardWidth([
    "6C1",
    "Ôn thi học sinh giỏi thành phố lớp 12",
  ]);

  assert.ok(minimumWidth > 160);
  assert.ok(getFeeClassCardsPerRow(1_100, minimumWidth) < 6);
  assert.equal(getFeeClassMinimumCardWidth(["6C1", "7C2"]), 160);
});

test("class filter paginates at exactly three rows and clamps page slices", () => {
  const items = Array.from({ length: 26 }, (_, index) => `class-${index}`);

  assert.equal(getFeeClassPageCount(items.length, 4), 3);
  assert.equal(getFeeClassPageIndex(12, 4), 1);
  assert.deepEqual(getFeeClassPageItems(items, 1, 4), items.slice(12, 24));
  assert.deepEqual(getFeeClassPageItems(items, 99, 4), items.slice(24));
  assert.equal(getFeeClassPageColumnCount(12, 4), 4);
  assert.equal(getFeeClassPageColumnCount(8, 4), 3);
});
