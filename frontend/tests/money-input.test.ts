import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoneyInput,
  getFormattedMoneyCaretPosition,
  parsePlainMoneyInput,
  parseSmartMoneyInput,
} from "../src/lib/forms/money-input";

test("smart money input expands supported Vietnamese million notation", () => {
  assert.deepEqual(parseSmartMoneyInput("1tr"), {
    value: 1_000_000,
    preview: "1.000.000",
  });
  assert.deepEqual(parseSmartMoneyInput("3.5tr"), {
    value: 3_500_000,
    preview: "3.500.000",
  });
  assert.deepEqual(parseSmartMoneyInput("1.505tr"), {
    value: 1_505_000,
    preview: "1.505.000",
  });
  assert.deepEqual(parseSmartMoneyInput("1tr505"), {
    value: 1_505_000,
    preview: "1.505.000",
  });
  assert.deepEqual(parseSmartMoneyInput("1tr5"), {
    value: 1_500_000,
    preview: "1.500.000",
  });
  assert.deepEqual(parseSmartMoneyInput("1tr50"), {
    value: 1_500_000,
    preview: "1.500.000",
  });
  assert.deepEqual(parseSmartMoneyInput("1tr500"), {
    value: 1_500_000,
    preview: "1.500.000",
  });
});

test("plain money input preserves an actual empty state", () => {
  assert.equal(parsePlainMoneyInput(""), null);
  assert.equal(parsePlainMoneyInput("750.000"), 750_000);
  assert.equal(formatMoneyInput(null), "");
  assert.equal(formatMoneyInput(0), "0");
});

test("formatted money edits preserve the logical digit caret", () => {
  assert.equal(
    getFormattedMoneyCaretPosition("1.00.000", 2, "100.000"),
    1,
  );
  assert.equal(
    getFormattedMoneyCaretPosition("1600.000", 2, "1.600.000"),
    3,
  );
  assert.equal(
    getFormattedMoneyCaretPosition("1.600.000", 3, "1.600.000"),
    3,
  );
});

test("money input rejects comma, k and mixed units", () => {
  assert.equal(parseSmartMoneyInput("1,5tr").value, null);
  assert.equal(parseSmartMoneyInput("100k").value, null);
  assert.equal(parseSmartMoneyInput("1tr505k").value, null);
  assert.equal(parsePlainMoneyInput("100,000"), null);
});
