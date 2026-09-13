import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCIAL_AMOUNT_MASK,
  formatFinancialAmount,
  getFinancialPrivacyStorageKey,
  parseFinancialPrivacyValue,
} from "../src/lib/financial-privacy";

test("financial privacy storage is scoped to the signed-in user", () => {
  assert.equal(
    getFinancialPrivacyStorageKey("user-a"),
    "tpro:financial-privacy:user-a",
  );
  assert.notEqual(
    getFinancialPrivacyStorageKey("user-a"),
    getFinancialPrivacyStorageKey("user-b"),
  );
  assert.equal(parseFinancialPrivacyValue("hidden"), true);
  assert.equal(parseFinancialPrivacyValue("visible"), false);
  assert.equal(parseFinancialPrivacyValue(null), false);
});

test("financial amount masking never retains a visible amount or sign", () => {
  assert.equal(formatFinancialAmount(38_262_000, true), FINANCIAL_AMOUNT_MASK);
  assert.equal(formatFinancialAmount(-38_262_000, true, { prefix: "−" }), FINANCIAL_AMOUNT_MASK);
  assert.equal(formatFinancialAmount(null, true), "—");
  assert.equal(formatFinancialAmount(375_000, false), "375.000đ");
  assert.equal(formatFinancialAmount(-375_000, false, { prefix: "−" }), "−375.000đ");
});
