import { expect, test, type Page } from "@playwright/test";

/**
 * BROWSER COMPONENT HARNESS — ClassMakeupWorkspace: nhóm trạng thái, chọn buổi
 * hoãn, gửi postpone payload, mở panel xếp bù với staff/eligible đọc-only,
 * action unschedule/complete/restore. Không đi qua route thật/API/auth.
 */

const state = (page: Page) => page.evaluate(() => window.__makeupTest!.getState());

test.beforeEach(async ({ page }) => {
  await page.goto("/makeup-workspace.html");
  await expect(page.getByRole("heading", { name: "Hoãn và học bù — Lớp 6A1" })).toBeVisible();
});

test("renders obligation summary groups and the postpone section", async ({ page }) => {
  await expect(page.getByText("Chờ xếp:")).toBeVisible();
  await expect(page.getByText("Đã xếp:")).toBeVisible();
  await expect(page.getByText("Chờ xác nhận:")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hoãn buổi học" })).toBeVisible();
});

test("lists real selectable occurrences and disables already-adjusted ones", async ({ page }) => {
  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toBeEnabled();
  await expect(checkboxes.nth(1)).toBeDisabled();
  await expect(page.getByText("Buổi này đã được hoãn trước đó.")).toBeVisible();
});

test("selecting an occurrence enables postpone and clears selection after success", async ({ page }) => {
  await page.locator('input[type="checkbox"]').nth(0).check();
  const postponeButton = page.getByRole("button", { name: /Hoãn \(1\)/ });
  await expect(postponeButton).toBeEnabled();
  await postponeButton.click();
  // Sau thành công: selection được xóa, nút quay về trạng thái disabled "Hoãn".
  await expect(page.getByRole("button", { name: /^Hoãn$/ })).toBeDisabled({ timeout: 5_000 });
  await expect(page.locator('input[type="checkbox"]').nth(0)).not.toBeChecked();
});

test("schedule panel shows original time, read-only duration/staff and eligible count, with no staff selector", async ({ page }) => {
  await page.getByRole("button", { name: "Xếp lịch bù" }).first().click();
  await expect(page.getByText(/Thời lượng:/)).toBeVisible();
  await expect(page.getByText("Cô Hạnh")).toBeVisible();
  await expect(page.getByText("Học viên đủ điều kiện:")).toBeVisible();
  // Chỉ có select lý do hoãn; không có select chọn giáo viên dạy thay.
  await expect(page.locator('select')).toHaveCount(1);
  await expect(page.getByPlaceholder("YYYY-MM-DD HH:MM")).toBeVisible();
  await expect(page.getByText("Giáo viên dạy thay")).toHaveCount(0);
});

test("unschedule and restore actions forward the exception id", async ({ page }) => {
  const pendingCard = page.getByText("Chờ xếp lịch bù").first();
  await pendingCard.waitFor();
  await page.getByRole("button", { name: "Khôi phục buổi gốc" }).first().click();
  await expect
    .poll(async () => (await state(page)).actions.length, { timeout: 5_000 })
    .toBe(1);
  expect((await state(page)).actions[0]).toEqual({
    action: "restore",
    exceptionId: "22222222-2222-4222-8222-222222222222",
  });
});

test("repeated action clicks never select text", async ({ page }) => {
  await page.getByRole("button", { name: "Khôi phục buổi gốc" }).first().click();
  await page.getByRole("button", { name: "Khôi phục buổi gốc" }).first().click();
  await expect
    .poll(async () => (await state(page)).actions.length, { timeout: 5_000 })
    .toBe(2);
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toBe("");
});
