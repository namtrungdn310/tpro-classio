import { expect, test, type Page } from "@playwright/test";

const feeId = "11111111-1111-4111-8111-111111111111";
async function setup(page: Page, failure?: "timeout" | "stale") {
  const applies: Record<string, unknown>[] = [];
  await page.route("**/fees/*/due-date/*", async (route) => {
    const body = route.request().postDataJSON();
    const isApply = route.request().url().endsWith("/apply");
    if (isApply) {
      applies.push(body);
      if (failure && applies.length === 1) {
        if (failure === "timeout") return route.abort("timedout");
        return route.fulfill({ status: 409, json: { detail: {
          code: "STALE_MEMBERSHIP_PREVIEW", message: "Dữ liệu đã thay đổi, hãy xem lại",
        } } });
      }
    }
    await route.fulfill({ json: {
      fee_record_id: feeId, previous_due_date: "2026-09-01", next_due_date: body.due_date,
      amount: 900000, coverage_start: "2026-09-01", coverage_end: "2026-10-01",
      schedule_unchanged: true, already_notified: true, becomes_overdue: false,
      preview_fingerprint: "a".repeat(64),
    } });
  });
  await page.goto("/billing-dates.html");
  await page.getByLabel("Lý do", { exact: true }).fill("Gia hạn theo yêu cầu phụ huynh");
  return applies;
}

test("preview is required and draft changes invalidate confirmation", async ({ page }) => {
  const applies = await setup(page);
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(page.getByLabel("Xem trước hạn thu")).toBeVisible();
  await expect(page.getByText("Khoản này đã thông báo.", { exact: false })).toBeVisible();
  expect(applies).toHaveLength(0);
  await page.getByLabel("Lý do", { exact: true }).fill("Lý do thay đổi sau khi xem trước");
  await expect(page.getByRole("button", { name: "Xác nhận hạn thu" })).toHaveCount(0);
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByRole("status")).toHaveText("saved");
  expect(applies).toHaveLength(1);
  expect(applies[0].expected_preview_fingerprint).toBe("a".repeat(64));
});

test("uncertain save locks draft and retries the identical command", async ({ page }) => {
  const applies = await setup(page, "timeout");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByText("Chưa rõ kết quả lưu.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Lý do", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByRole("status")).toHaveText("saved");
  expect(applies).toHaveLength(2);
  expect(applies[1]).toEqual(applies[0]);
});

test("stale response does not claim success and permits another preview", async ({ page }) => {
  await setup(page, "stale");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận hạn thu" }).click();
  await expect(page.getByRole("alert")).toContainText("Dữ liệu đã thay đổi");
  await page.getByRole("button", { name: "Xem lại", exact: true }).click();
  await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeEnabled();
});

test("mobile dialog stays inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("button", { name: "Xem trước", exact: true })).toBeInViewport();
});

for (const billingType of ["MONTHLY", "COURSE"]) {
  test(`${billingType}: unresolved gap blocks apply until explicit waiver`, async ({ page }) => {
    const calls: Record<string, unknown>[] = [];
    const id = "22222222-2222-4222-8222-222222222222";
    await page.route("**/enrollments/*/billing-schedule**", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: {
        enrollment_id: id, anchor_date: "2026-09-01", version: 0,
        billing_type: billingType, cycle_weeks: billingType === "COURSE" ? 4 : null,
        review_pending: false, fees: [], history: [],
      } });
      const body = route.request().postDataJSON();
      if (route.request().url().endsWith("/options")) return route.fulfill({ json: {
        business_date: "2026-09-01", classification: { time_direction: "FUTURE", distance: "NEAR", anchor_relative: "LATER", case_code: "NEAR_FUTURE", summary: "Tương lai gần" },
        current_anchor_date: "2026-09-01", new_anchor_date: body.anchor_date, expected_version: 0,
        cycle_info: null, financial_state: { protected_through: null, has_protected_fees: false, protected_count: 0, mutable_count: 0, unpaid_notified_count: 0, active_fees_count: 0 },
        options: [{ id: "KEEP_CURRENT", strategy: "KEEP_CURRENT", label: "Giữ kỳ hiện tại", description: "Áp dụng kỳ sau", is_allowed: true, is_recommended: true, requires_gap_policy: true }],
        recommended_option_id: "KEEP_CURRENT", is_blocked: false, context_token: "a".repeat(64),
      } });
      if (route.request().url().endsWith("/apply")) calls.push(body);
      const gap = { start: "2026-09-01", end: "2026-09-05" };
      await route.fulfill({ json: { can_apply: body.gap_policy !== "REVIEW",
        preview_fingerprint: "b".repeat(64), current_anchor_date: "2026-09-01",
        plan: { enrollment_id: id, version: 0, business_date: "2026-09-01",
          anchor: body.anchor_date, billing_type: billingType,
          cycle_weeks: billingType === "COURSE" ? 4 : null, first_cycle: 0,
          keep_ids: [], supersede_ids: [], charges: [],
          waived_intervals: body.gap_policy === "WAIVE" ? [gap] : [],
          gap_intervals: body.gap_policy === "REVIEW" ? [gap] : [],
          source_digest: "c".repeat(64), reason: body.reason, policy_version: 1,
        },
      } });
    });
    await page.goto("/billing-dates.html?inline");
    const input = page.getByLabel("Mốc thu học phí", { exact: true });
    await input.click();
    await input.press("ControlOrMeta+A");
    await input.pressSequentially("05/09/2026");
    await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
    await page.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Xác nhận miễn khoảng chuyển tiếp");
    await page.getByRole("button", { name: "Xác nhận mốc" }).click();
    await page.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^saved$/ })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].gap_policy).toBe("WAIVE");
    expect(calls[0]).not.toHaveProperty("enrollment_date");
  });
}
