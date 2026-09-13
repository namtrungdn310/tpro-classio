import test from "node:test";
import assert from "node:assert/strict";
import { billingScheduleOptionsResponseSchema } from "../src/lib/api/billing-dates";

const response = {
  business_date: "2026-09-09",
  classification: { time_direction: "FUTURE", distance: "FAR", anchor_relative: "LATER", case_code: "FAR_FUTURE", summary: "Tương lai xa" },
  current_anchor_date: "2026-09-01", new_anchor_date: "2026-12-15", expected_version: 2,
  cycle_info: { current_cycle_no: 0, current_cycle_start: "2026-09-01", current_cycle_end: "2026-10-01", billing_type: "MONTHLY", cycle_weeks: null },
  financial_state: { protected_through: "2026-10-01", has_protected_fees: true, protected_count: 1, mutable_count: 0, unpaid_notified_count: 0, active_fees_count: 1 },
  options: [{ id: "CONTINUE_OLD_UNTIL_NEW", strategy: "CONTINUE_OLD_UNTIL_NEW", label: "Tiếp tục lịch cũ", description: "Đổi tại mốc mới", is_recommended: true, is_allowed: true, requires_gap_policy: true }],
  is_blocked: false, context_token: "a".repeat(64),
};

test("options accept the structured backend classification and financial field names", () => {
  const parsed = billingScheduleOptionsResponseSchema.parse(response);
  assert.equal(parsed.classification.case_code, "FAR_FUTURE");
  assert.equal(parsed.financial_state.protected_count, 1);
  assert.equal(parsed.options[0].requires_gap_policy, true);
});

test("blocked responses may have no anchor or cycle baseline", () => {
  const parsed = billingScheduleOptionsResponseSchema.parse({ ...response, current_anchor_date: null, cycle_info: null, options: [], is_blocked: true });
  assert.equal(parsed.cycle_info, null);
});

test("old invented string classification is rejected, not silently treated as safe", () => {
  assert.equal(billingScheduleOptionsResponseSchema.safeParse({ ...response, classification: "FAR_FUTURE" }).success, false);
});
