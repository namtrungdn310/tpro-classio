import { expect, test } from "@playwright/test";

test("deleting date segments never appends stray yy or reports an error while typing", async ({ page }) => {
  let checks = 0;
  await page.route("**/enrollments/*/billing-schedule**", async route => {
    if (route.request().method() !== "GET") { checks++; return route.abort(); }
    return route.fulfill({ json: { enrollment_id: "22222222-2222-4222-8222-222222222222", anchor_date: "2026-09-01", version: 0, billing_type: "MONTHLY", cycle_weeks: null, review_pending: false } });
  });
  await page.goto("/billing-dates.html?inline");
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await expect(input).toHaveValue("01/09/2026");
  await input.focus();
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 2));
  await input.press("Backspace");
  await expect(input).toHaveValue("/09/2026");
  const guide = input.locator("..").locator('[aria-hidden="true"]');
  await expect(guide).not.toContainText("yy");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Nhập mốc thu hợp lệ", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xử lý thay đổi" })).toBeDisabled();
  await input.pressSequentially("01");
  await expect(input).toHaveValue("01/09/2026");
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 5));
  await input.press("Backspace");
  await expect(input).toHaveValue("01//2026");
  await expect(guide).not.toContainText("yy");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await expect(guide).toContainText("dd/mm/yyyy");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Chưa lưu.", { exact: false })).toHaveCount(0);
  expect(checks).toBe(0);
});

test("unchanged date renders without a processing button even if status request fails", async ({ page }) => {
  await page.route("**/enrollments/*/billing-schedule**", (route) => route.abort());
  await page.goto("/billing-dates.html?inline");
  await expect(page.getByLabel("Mốc thu học phí", { exact: true })).toHaveValue("01/09/2026");
  await expect(page.getByRole("button", { name: "Xử lý thay đổi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("inline date checks the latest draft and opens a right-side review without saving", async ({ page }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  const optionsCalls: string[] = [];
  let applies = 0;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await page.route("**/enrollments/*/billing-schedule**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          enrollment_id: id,
          anchor_date: "2026-09-01",
          version: 0,
          billing_type: "MONTHLY",
          cycle_weeks: null,
          review_pending: false,
          fees: [],
          history: [],
        },
      });
    }
    const body = route.request().postDataJSON() || {};
    const url = route.request().url();

    if (url.endsWith("/options")) {
      optionsCalls.push(body.anchor_date);
      if (body.anchor_date === "2026-09-05") await firstResponse;
      return route.fulfill({
        json: {
          business_date: "2026-09-01",
          classification: { time_direction: "FUTURE", distance: "NEAR", anchor_relative: "LATER", case_code: "NEAR_FUTURE", summary: "Tương lai gần" },
          current_anchor_date: "2026-09-01",
          new_anchor_date: body.anchor_date,
          expected_version: 0,
          cycle_info: {
            current_cycle_no: 0, billing_type: "MONTHLY",
            current_cycle_start: "2026-09-01",
            current_cycle_end: "2026-10-01",
          },
          financial_state: {
            has_protected_fees: false,
            protected_through: null, protected_count: 0, mutable_count: 0,
            unpaid_notified_count: 0, active_fees_count: 0,
          },
          options: [
            {
              id: "KEEP_CURRENT",
              strategy: "KEEP_CURRENT",
              label: "Giữ kỳ hiện tại, áp dụng từ kỳ kế tiếp",
              description: "Bảo vệ các khoản đã thu",
              is_recommended: true,
              is_allowed: true,
              requires_gap_policy: false,
              requires_historical_selection: false,
            },
          ],
          recommended_option_id: "KEEP_CURRENT",
          is_blocked: false,
          context_token: "token_123",
        },
      });
    }

    if (url.endsWith("/apply")) applies++;

    return route.fulfill({
      json: {
        can_apply: true,
        preview_fingerprint: "b".repeat(64),
        current_anchor_date: "2026-09-01",
        plan: {
          enrollment_id: id,
          version: 0,
          business_date: "2026-09-01",
          anchor: body.anchor_date,
          billing_type: "MONTHLY",
          cycle_weeks: null,
          first_cycle: 0,
          keep_ids: [],
          supersede_ids: [],
          charges: [
            {
              coverage: { start: body.anchor_date, end: "2026-10-08" },
              due_date: body.anchor_date,
              amount: 900000,
              cycle_no: 0,
              kind: "CYCLE",
            },
          ],
          waived_intervals: [],
          gap_intervals: [],
          source_digest: "c".repeat(64),
          reason: body.reason || "Lý do kiểm thử",
          policy_version: 1,
        },
      },
    });
  });

  await page.goto("/billing-dates.html?inline");
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("05/09/2026");
  await expect.poll(() => optionsCalls.length).toBe(1);
  await expect(page.getByRole("button", { name: "Đang kiểm tra" })).toBeDisabled();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("08/09/2026");
  releaseFirst();

  await page.getByRole("button", { name: "Xử lý thay đổi", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Xử lý đổi mốc thu học phí" });
  await expect(panel.getByText("01/09/2026 → 08/09/2026")).toBeVisible();
  await expect(panel.locator("#billing-anchor-input")).toHaveCount(0);
  expect(optionsCalls).toHaveLength(2);
  await expect(panel.getByRole("button", { name: "Xác nhận mốc", exact: true })).toBeEnabled();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThan(700);
  expect(Math.round(box!.x + box!.width)).toBe(1440);
  expect(applies).toBe(0);

  await panel.getByLabel("Lý do điều chỉnh", { exact: true }).fill("Điều chỉnh ngày thu theo yêu cầu");
  await expect(panel.getByRole("button", { name: "Xác nhận mốc", exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = await panel.boundingBox();
  expect(mobile!.x).toBe(0);
  expect(mobile!.width).toBe(375);
  await expect(panel.getByRole("button", { name: "Xác nhận mốc", exact: true })).toBeInViewport();
});

test("invalid or empty dates never preview; a failed check can be retried", async ({ page }) => {
  let checks = 0;
  await page.route("**/enrollments/*/billing-schedule**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          enrollment_id: "22222222-2222-4222-8222-222222222222",
          anchor_date: "2026-09-01",
          version: 0,
          billing_type: "MONTHLY",
          cycle_weeks: null,
          review_pending: false,
          fees: [],
          history: [],
        },
      });
    }
    checks++;
    await route.fulfill({ status: 409, json: { detail: "Cần kiểm tra lại lịch thu" } });
  });

  await page.goto("/billing-dates.html?inline");
  const input = page.getByLabel("Mốc thu học phí", { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(page.getByRole("button", { name: "Xử lý thay đổi" })).toBeDisabled();
  expect(checks).toBe(0);

  await input.pressSequentially("08/09/2026");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect.poll(() => checks).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("01/09/2026");
  await expect(page.getByRole("button", { name: "Xử lý thay đổi" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thử lại" })).toHaveCount(0);
  await expect(page.getByText("Chưa lưu.", { exact: false })).toHaveCount(0);
});
