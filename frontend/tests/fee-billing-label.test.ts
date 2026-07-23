import assert from "node:assert/strict";
import test from "node:test";
import { formatFeeBillingLabel } from "../src/lib/fees/billing-label";

test("formats monthly and course fee modes for the fee list", () => {
  assert.equal(formatFeeBillingLabel("MONTHLY", 1), "Theo tháng");
  assert.equal(formatFeeBillingLabel("COURSE", 3), "Theo khóa · 12 tuần");
  assert.equal(formatFeeBillingLabel("COURSE", 6), "Theo khóa · 24 tuần");
});
