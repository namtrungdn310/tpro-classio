import test from "node:test";
import assert from "node:assert/strict";
import { acceptPlan, matchesAcceptedPlan } from "../src/lib/billing/accepted-plan";

test("retry keeps the same accepted payload, fingerprint and request ID", () => {
  const draft = { anchor_date: "2026-09-01", reason: "Đổi lịch thu", gap_policy: "WAIVE" };
  const accepted = acceptPlan(draft, { preview_fingerprint: "a".repeat(64) }, "request-1");
  assert.ok(matchesAcceptedPlan(accepted, { ...draft }));
  assert.equal(accepted.requestId, "request-1");
  assert.equal(accepted.preview.preview_fingerprint, "a".repeat(64));
});

test("editing a financial choice or reason invalidates acceptance immediately", () => {
  const draft = { anchor_date: "2026-09-01", reason: "Đổi lịch thu", gap_policy: "WAIVE" };
  const accepted = acceptPlan(draft, {}, "request-1");
  for (const changed of [{ ...draft, anchor_date: "2026-10-01" }, { ...draft, reason: "Khác" }, { ...draft, gap_policy: "CHARGE" }]) {
    assert.equal(matchesAcceptedPlan(accepted, changed), false);
  }
  assert.equal(matchesAcceptedPlan(null, draft), false);
});
