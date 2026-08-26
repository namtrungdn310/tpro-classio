import { expect, test } from "@playwright/test";

/** Component harness for the whole-class postponement flow. */
async function chooseEndDate(page: import("@playwright/test").Page) {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  await page.getByRole("button", { name: /^Đến ngày/ }).click();
  const picker = page.locator('[role="dialog"]:visible').filter({ hasText: "Chọn ngày kết thúc hoãn" }).last();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: String(target.getFullYear()), exact: true }).click();
  await picker.getByRole("button", { name: `Tháng ${target.getMonth() + 1}`, exact: true }).click();
  await picker.getByRole("button", { name: String(target.getDate()), exact: true }).click();
  await picker.getByRole("button", { name: "Xác nhận", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/makeup-workspace.html");
  await expect(page.getByRole("heading", { name: "Hoãn buổi học — Lớp 6A1" })).toBeVisible();
});

test("renders a postponement-only workspace", async ({ page }) => {
  await expect(page.locator('section[aria-label="Hoãn buổi học"]')).toBeVisible();
  await expect(page.getByText("Từ ngày")).toBeVisible();
  await expect(page.getByText("Đến ngày")).toBeVisible();
  await expect(page.getByText("Lý do hoãn")).toBeVisible();
  await expect(page.getByText("Ghi chú", { exact: true })).toBeVisible();
  await expect(page.getByText(/Xếp lịch bù|Xếp bù ngay|Xếp sau|Đã học bù/)).toHaveCount(0);
});

test("shows automatic occurrence and member preview after choosing a range", async ({ page }) => {
  await chooseEndDate(page);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByText(/Hệ thống sẽ tự động hoãn 1 buổi hợp lệ/)).toBeVisible();
  await expect(page.getByText(/Ngày thu sẽ dời theo số ngày hoãn thực tế/)).toBeVisible();
});

test("submits one suspension request and repeated actions do not select text", async ({ page }) => {
  await chooseEndDate(page);
  const postponeButton = page.getByRole("button", { name: /Hoãn \(1\)/ });
  await expect(postponeButton).toBeEnabled();
  await postponeButton.click();
  await expect(postponeButton).toBeEnabled({ timeout: 5_000 });
  await postponeButton.click();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toBe("");
});
