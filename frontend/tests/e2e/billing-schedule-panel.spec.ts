import { expect, test, type Page } from "@playwright/test";
import { fulfillScheduleRead } from "./billing-list-fixture";

const id = "22222222-2222-4222-8222-222222222222";
const schedule = {
  enrollment_id: id, anchor_date: "2026-09-01", version: 0, billing_type: "MONTHLY", cycle_weeks: null,
  review_pending: false, history: [],
  fees: Array.from({ length: 35 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    coverage_start: "2026-09-01", coverage_end: "2026-10-01", due_date: "2026-09-01", amount: 900000,
    status: i === 0 ? "PAID" : i === 1 ? "SUPERSEDED" : i === 2 ? "VOID" : "UNPAID",
    paid_amount: i === 0 ? 900000 : 0, refunded_amount: i === 0 ? 100000 : 0, protected: i === 0,
  })),
};
async function setup(page: Page, failApply: boolean | "stale" = false, pending = false, futureWaivers = false) {
  const waivers = futureWaivers ? [{ start: "2026-11-01", end: "2026-12-15" }] : [];
  const pendingReview = pending ? { id: "33333333-3333-4333-8333-333333333333", change_kind: "INITIAL_BACKDATED", reason: "Ghi danh ở quá khứ", created_at: "2026-09-01T00:00:00Z", anchor_date: schedule.anchor_date, fees: [] } : null;
  const commands: unknown[] = [];
  await page.route("**/enrollments/*/billing-schedule**", async route => {
    if (route.request().method() === "GET") return fulfillScheduleRead(route, schedule);
    const draft = route.request().postDataJSON();
    if (route.request().url().endsWith("/options")) return route.fulfill({ json: {
      business_date: "2026-09-09", classification: { time_direction: "FUTURE", distance: "FAR", anchor_relative: "LATER", case_code: "FAR_FUTURE", summary: "Tương lai xa" },
      current_anchor_date: schedule.anchor_date, new_anchor_date: draft.anchor_date, expected_version: 0,
      cycle_info: null, financial_state: { has_protected_fees: true, protected_through: "2026-10-01", protected_count: 1, mutable_count: 32, unpaid_notified_count: 0, active_fees_count: 33 },
      is_blocked: false, context_token: "a".repeat(64), recommended_option_id: "KEEP_CURRENT",
      pending_review: pendingReview,
      replaceable_waived_intervals: waivers,
      options: [{ id: "KEEP_CURRENT", strategy: "KEEP_CURRENT", label: "Giữ kỳ hiện tại", description: "Bắt đầu lịch mới sau kỳ hiện tại", is_allowed: true, is_recommended: true, requires_gap_policy: true }],
    } });
    if (route.request().url().endsWith("/apply")) {
      commands.push(draft);
      if (failApply && commands.length === 1) {
        if (failApply === "stale") return route.fulfill({ status: 409, json: { detail: { code: "STALE_OPTIONS_CONTEXT", message: "Lịch thu đã thay đổi. Kiểm tra lại." } } });
        return route.abort("timedout");
      }
    }
    return route.fulfill({ json: {
      can_apply: draft.gap_policy !== "REVIEW", preview_fingerprint: "b".repeat(64), current_anchor_date: schedule.anchor_date,
      pending_review: pendingReview,
      plan: { enrollment_id: id, version: 0, business_date: "2026-09-09", anchor: draft.anchor_date, billing_type: "MONTHLY", cycle_weeks: null,
        first_cycle: 0, keep_ids: [], supersede_ids: [], charges: [], gap_intervals: [], waived_intervals: [],
        replaced_waived_intervals: draft.replace_future_waivers ? waivers : [],
        source_digest: "c".repeat(64), reason: draft.reason, policy_version: 1 },
    } });
  });
  await page.goto("/billing-dates.html?inline");
  return commands;
}
async function edit(page: Page) {
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("15/12/2026");
  await expect(input).toHaveValue("15/12/2026");
  await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
  return page.getByRole("dialog", { name: "Xử lý đổi mốc thu học phí" });
}

test("future waiver correction requires explicit consent and a new preview", async ({ page }, testInfo) => {
  const commands = await setup(page, true, false, true);
  const panel = await edit(page);
  const checkbox = panel.getByRole("checkbox", { name: "Thay thế phần miễn thu của kế hoạch tương lai chưa áp dụng" });
  await expect(checkbox).not.toBeChecked();
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Lưu", exact: true })).toBeEnabled();
  await checkbox.check();
  await expect(panel.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await expect(panel.getByText("Phần miễn thu cũ sẽ được thay thế khi lưu:")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("future-waiver-correction-mobile.png") });
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(checkbox).toBeDisabled();
  await panel.getByRole("button", { name: "Thử lại lưu", exact: true }).click();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toMatchObject({ replace_future_waivers: true });
  expect(commands[1]).toEqual(commands[0]);
});

test("pending review is explained and accepted inside the anchor change, including timeout retry", async ({ page }, testInfo) => {
  const commands = await setup(page, true, true);
  const panel = await edit(page);
  await expect(page.getByRole("button", { name: "Thử lại", exact: true })).toHaveCount(0);
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Sửa mốc của lịch chờ");
  await page.screenshot({ path: testInfo.outputPath("pending-review-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("pending-review-mobile.png") });
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await panel.getByRole("button", { name: "Thử lại lưu", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[0]).toMatchObject({ expected_pending_review_id: "33333333-3333-4333-8333-333333333333" });
  expect(commands[1]).toEqual(commands[0]);
});

test("change panel has only decision content, no report queries or lists", async ({ page }, testInfo) => {
  await setup(page);
  const reportRequests: string[] = [];
  page.on("request", r => { if (r.url().includes("/reports/")) reportRequests.push(r.url()); });
  await expect(page.getByRole("button", { name: "Xử lý thay đổi" })).toHaveCount(0);
  const panel = await edit(page);
  await expect(panel.getByRole("table")).toHaveCount(0);
  await expect(panel.getByText("Xem lịch hiện tại")).toHaveCount(0);
  await expect(panel.getByText("Lịch sử điều chỉnh")).toHaveCount(0);
  await expect(panel.getByLabel("Năm của kỳ thu")).toHaveCount(0);
  expect(reportRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("billing-panel-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("billing-panel-mobile.png") });
});

test("entering reason is dirty and closing keeps outer date", async ({ page }) => {
  await setup(page);
  const panel = await edit(page);
  await expect(panel.locator("#billing-anchor-input")).toHaveCount(0);
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Lý do thử nghiệm");
  await panel.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Thay đổi chưa được lưu" })).toBeVisible();
  await page.getByRole("button", { name: "Rời khỏi", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("Mốc thu học phí", { exact: true })).toHaveValue("15/12/2026");
});

test("custom application date is previewed and submitted instead of a suggested cycle", async ({ page }) => {
  const commands = await setup(page);
  const panel = await edit(page);
  await panel.getByRole("button", { name: "Chọn thời điểm áp dụng khác" }).click();
  const input = panel.getByLabel("Áp dụng từ kỳ bắt đầu vào hoặc sau ngày", { exact: true });
  await input.fill("20/02/2027");
  await input.blur();
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Chọn thời điểm theo yêu cầu phụ huynh");
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ apply_from_date: "2027-02-20" });
  expect(commands[0]).not.toHaveProperty("first_cycle");
});

test("timeout locks the choices and retries the same command", async ({ page }) => {
  const commands = await setup(page, true);
  const panel = await edit(page);
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Phụ huynh yêu cầu đổi lịch");
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel.getByLabel("Lý do điều chỉnh", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("radio")).toBeDisabled();
  await panel.getByRole("button", { name: "Thử lại lưu", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test("loading to content keeps the same physical panel with real motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/enrollments/*/billing-schedule**", async route => {
    await wait;
    await fulfillScheduleRead(route, schedule);
  });
  await page.goto("/billing-dates.html?schedule");
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("status")).toHaveText("Đang tải lịch thu");
  await panel.evaluate(el => { el.setAttribute("data-test-identity", "same-panel"); });
  release();
  await expect(panel.getByText("Không có thay đổi mốc thu cần xử lý.")).toBeVisible();
  await expect(panel).toHaveAttribute("data-test-identity", "same-panel");
  const positions = await panel.evaluate(async el => {
    const values: number[] = [];
    for (let i = 0; i < 35; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      values.push(el.getBoundingClientRect().left);
    }
    return values;
  });
  for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeLessThanOrEqual(positions[i - 1] + 0.5);
  expect(Math.abs(positions.at(-1)! - 800)).toBeLessThan(1);
});

test("stale apply requires fresh analysis and does not silently retry", async ({ page }) => {
  const commands = await setup(page, "stale");
  const panel = await edit(page);
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Phụ huynh yêu cầu đổi lịch");
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Lịch thu đã thay đổi");
  await expect(panel.getByRole("button", { name: "Xác nhận mốc", exact: true })).toBeDisabled();
  expect(commands).toHaveLength(1);
  await panel.getByRole("button", { name: "Kiểm tra lại", exact: true }).click();
  await panel.getByRole("button", { name: "Xác nhận mốc", exact: true }).click();
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(commands).toHaveLength(2);
});

test("past cycles are paginated, never preselected, and invalid first cycles cannot apply", async ({ page }) => {
  const commands = await setup(page);
  const offsets: number[] = [];
  await page.route("**/billing-schedule/options", async route => {
    const draft = route.request().postDataJSON();
    const offset = draft.historical_offset ?? 0;
    offsets.push(offset);
    await route.fulfill({ json: {
      business_date: "2026-09-09", classification: { time_direction: "PAST", distance: "FAR", anchor_relative: "EARLIER", case_code: "FAR_PAST", summary: "Quá khứ xa" },
      current_anchor_date: schedule.anchor_date, new_anchor_date: draft.anchor_date, expected_version: 0,
      cycle_info: null, financial_state: { has_protected_fees: false, protected_through: null, protected_count: 0, mutable_count: 0, unpaid_notified_count: 0, active_fees_count: 0 },
      is_blocked: false, context_token: "a".repeat(64), recommended_option_id: "FROM_CYCLE",
      options: [{ id: "FROM_CYCLE", strategy: "FROM_CYCLE", label: "Chọn kỳ bắt đầu", description: "Chỉ truy thu các kỳ đã chọn", is_allowed: true, is_recommended: true,
        requires_historical_selection: true, requires_gap_policy: true, suggested_first_cycle: 24,
        historical_offset: offset, historical_limit: 12, has_more_historical_cycles: offset === 0,
        available_historical_cycles: [{ cycle_no: offset, coverage_start: "2025-01-01", coverage_end: "2025-02-01", base_due_date: "2025-01-01", amount: 900000, label: `Kỳ quá khứ ${offset + 1}` }],
      }],
    } });
  });
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("01/01/2024");
  await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await panel.getByRole("button", { name: "Xem thêm các kỳ trước đó" }).click();
  await expect(panel.getByRole("checkbox")).toHaveCount(2);
  await expect(panel.getByRole("checkbox").nth(1)).not.toBeChecked();
  expect(offsets).toEqual([0, 12]);
  await panel.getByRole("checkbox").nth(1).check();
  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Truy thu một kỳ đã thống nhất");
  await panel.getByLabel("Kỳ bắt đầu áp dụng", { exact: true }).fill("0");
  await expect(panel.getByRole("button", { name: "Xác nhận mốc" })).toBeDisabled();
  await panel.getByLabel("Kỳ bắt đầu áp dụng", { exact: true }).fill("25");
  await panel.getByRole("button", { name: "Xác nhận mốc" }).click();
  await panel.getByRole("button", { name: "Lưu" }).click();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ first_cycle: 24, historical_cycles: [12] });
});

test("renders all strategy options including disabled ones with proper badges and clean transition inputs", async ({ page }, testInfo) => {
  await setup(page);
  await page.route("**/billing-schedule/options", async route => {
    const draft = route.request().postDataJSON();
    await route.fulfill({ json: {
      business_date: "2026-09-09", classification: { time_direction: "FUTURE", distance: "NEAR", anchor_relative: "LATER", case_code: "NEAR_FUTURE", summary: "Tương lai gần" },
      current_anchor_date: schedule.anchor_date, new_anchor_date: draft.anchor_date, expected_version: 0,
      cycle_info: null, financial_state: { has_protected_fees: true, protected_through: "2026-10-01", protected_count: 1, mutable_count: 32, unpaid_notified_count: 0, active_fees_count: 33 },
      is_blocked: false, context_token: "a".repeat(64), recommended_option_id: "KEEP_CURRENT",
      options: [
        { id: "KEEP_CURRENT", strategy: "KEEP_CURRENT", label: "Giữ kỳ hiện tại", description: "Bắt đầu lịch mới sau kỳ hiện tại", is_allowed: true, is_recommended: true, requires_gap_policy: true },
        { id: "REPLACE_CURRENT", strategy: "REPLACE_CURRENT", label: "Tính lại từ kỳ hiện tại", description: "Không thể tính lại vì đã có kỳ thu được thanh toán.", is_allowed: false, is_recommended: false, disabled_reason: "Đã có khoản thanh toán được bảo vệ" },
      ],
    } });
  });
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("20/09/2026");
  await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
  const panel = page.getByRole("dialog");

  // Verify subtitle is absent
  await expect(panel.getByText("Chọn thời điểm bắt đầu tính lịch thu học phí theo mốc ngày mới.")).toHaveCount(0);

  // Verify both options are visible
  await expect(panel.getByText("Áp dụng mốc mới từ kỳ tiếp theo")).toBeVisible();
  await expect(panel.getByText("Áp dụng mốc mới ngay kỳ hiện tại")).toBeVisible();

  // Verify option counts badge
  await expect(panel.getByText("2 phương án")).toBeVisible();

  // Verify disabled option badge & disabled radio
  await expect(panel.getByText("Không khả dụng", { exact: true })).toBeVisible();
  const radios = panel.getByRole("radio");
  await expect(radios).toHaveCount(2);
  await expect(radios.nth(0)).toBeChecked();
  await expect(radios.nth(0)).toBeEnabled();
  await expect(radios.nth(1)).toBeDisabled();
  await expect(radios.nth(1)).not.toBeChecked();

  // Clicking disabled option should not change selection
  await panel.getByText("Áp dụng mốc mới ngay kỳ hiện tại").click({ force: true });
  await expect(radios.nth(0)).toBeChecked();
  await expect(radios.nth(1)).not.toBeChecked();

  // Verify KEEP_CURRENT description
  await expect(panel.getByText("Bắt đầu lịch mới sau kỳ hiện tại")).toBeVisible();

  // Verify transition fields are completely removed from TPRO business UI
  await expect(panel.getByText("Xử lý khoảng chuyển tiếp")).toHaveCount(0);
  await expect(panel.getByLabel("Xử lý khoảng chuyển tiếp", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Phí khoảng lẻ riêng (tuỳ chọn)", { exact: true })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("multiple-options-panel.png") });
});
