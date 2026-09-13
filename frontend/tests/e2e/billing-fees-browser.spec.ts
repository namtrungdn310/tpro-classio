import { expect, test } from "@playwright/test";
import { fulfillScheduleRead } from "./billing-list-fixture";

const fixture = {
  enrollment_id: "22222222-2222-4222-8222-222222222222", anchor_date: "2026-09-01", version: 0,
  billing_type: "MONTHLY", cycle_weeks: null, review_pending: false, history: [],
  fees: Array.from({ length: 65 }, (_, i) => {
    const year = i < 40 ? 2026 : 2025;
    const month = String(i % 12 + 1).padStart(2, "0");
    return { id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      coverage_start: `${year}-${month}-01`, coverage_end: `${year}-${month}-28`, due_date: `${year}-${month}-01`, amount: 900000,
      paid_amount: i === 0 || i === 3 ? 900000 : 0, refunded_amount: i === 0 ? 100000 : 0,
      status: i === 0 || i === 3 ? "PAID" : i === 1 ? "VOID" : i === 2 ? "SUPERSEDED" : "UNPAID", protected: i === 0 || i === 3,
    };
  }),
};

test("server pages, year/state filters and old unpaid reminder work without any financial writes", async ({ page }) => {
  const reads: string[] = [];
  let writes = 0;
  await page.route("**/reports/billing/enrollments/*/fees**", async route => {
    if (route.request().method() !== "GET") { writes++; return route.abort(); }
    reads.push(route.request().url());
    await fulfillScheduleRead(route, fixture);
  });
  await page.goto("/billing-dates.html?fees");
  const panel = page.getByRole("region", { name: "Tra cứu khoản thu" });
  await expect(panel.getByRole("status")).toHaveText("1–20 / 38 khoản");
  await expect(panel.getByRole("rowgroup", { name: "Các khoản thu" }).getByRole("row")).toHaveCount(20);
  await expect(panel.getByText("Có 25 khoản chưa thu thuộc các năm trước năm 2026.")).toBeVisible();
  await panel.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("21–38 / 38 khoản");
  await panel.getByLabel("Trạng thái", { exact: true }).selectOption("PAID");
  await expect(panel.getByRole("status")).toHaveText("1–1 / 1 khoản");
  await panel.getByLabel("Trạng thái", { exact: true }).selectOption("REFUNDED");
  await expect(panel.getByText("Đã hoàn một phần", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Xem khoản chưa thu" }).click();
  await expect(panel.getByLabel("Năm của kỳ thu", { exact: true })).toHaveValue("0");
  await expect(panel.getByRole("status")).toHaveText("1–20 / 61 khoản");
  await panel.getByLabel("Năm của kỳ thu", { exact: true }).selectOption("2025");
  await expect(panel.getByRole("status")).toHaveText("1–20 / 25 khoản");
  await panel.getByLabel("Trạng thái", { exact: true }).selectOption("ALL");
  await panel.getByLabel("Năm của kỳ thu", { exact: true }).selectOption("2026");
  await panel.getByLabel("Hiện khoản đã hủy / đã thay thế").check();
  await expect(panel.getByRole("status")).toHaveText("1–20 / 40 khoản");
  await panel.getByLabel("Sắp xếp kỳ thu", { exact: true }).selectOption("asc");
  await expect(panel.getByRole("rowgroup", { name: "Các khoản thu" }).getByRole("row").first()).toContainText("01/01/2026");
  const header = panel.getByRole("columnheader", { name: "Kỳ thu" });
  const before = await header.boundingBox();
  const rows = panel.getByRole("rowgroup", { name: "Các khoản thu" });
  await rows.evaluate(el => { el.scrollTop = 500; });
  expect((await header.boundingBox())!.y).toBe(before!.y);
  expect(await rows.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(reads.every(u => u.includes("/reports/billing/"))).toBe(true);
  expect(reads.some(u => u.includes("page=2"))).toBe(true);
  expect(writes).toBe(0);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("failed list can retry, while delayed old filter response never overwrites newer choice", async ({ page }) => {
  let first = true;
  let release!: () => void;
  let seen!: () => void;
  const held = new Promise<void>(r => { release = r; });
  const started = new Promise<void>(r => { seen = r; });
  await page.route("**/reports/billing/enrollments/*/fees**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/fees") && first) {
      first = false;
      return route.fulfill({ status: 403, json: { detail: "Không tải được danh sách" } });
    }
    if (url.searchParams.get("year") === "2025") { seen(); await held; }
    await fulfillScheduleRead(route, fixture);
  });
  await page.goto("/billing-dates.html?fees");
  const panel = page.getByRole("region", { name: "Tra cứu khoản thu" });
  await panel.getByRole("button", { name: "Thử lại danh sách" }).click();
  await expect(panel.getByRole("status")).toHaveText("1–20 / 38 khoản");
  await panel.getByLabel("Năm của kỳ thu", { exact: true }).selectOption("2025");
  await started;
  await panel.getByLabel("Năm của kỳ thu", { exact: true }).selectOption("2026");
  release();
  await expect(panel.getByRole("status")).toHaveText("1–20 / 38 khoản");
  await expect(panel.getByLabel("Năm của kỳ thu", { exact: true })).toHaveValue("2026");
});
