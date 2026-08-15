import { expect, test, type Page } from "@playwright/test";

/**
 * BROWSER COMPONENT HARNESS — ClassWorkspaceDialog: mở thẳng chế độ Sửa,
 * chuyển mode qua rail (tablist), chấm vàng khi dirty, hủy 2 bước, đóng với
 * xác nhận bỏ thay đổi. Không đi qua route thật/API/auth.
 */

const state = (page: Page) => page.evaluate(() => window.__workspaceTest.getState());

const editTab = (page: Page) => page.locator('[role="tab"][aria-label="Sửa lớp"]');
const historyTab = (page: Page) => page.locator('[role="tab"][aria-label="Xem hồ sơ"]');
const cancelTab = (page: Page) => page.locator('[role="tab"][aria-label="Hủy lớp"]');

test.beforeEach(async ({ page }) => {
  await page.goto("/class-workspace.html");
  await expect(page.locator("#class-name")).toBeVisible();
});

test("opens directly in edit mode with a four-tab rail", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Sửa lớp học" })).toBeVisible();
  await expect(editTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[role="tablist"] [role="tab"]:visible')).toHaveCount(4);
});

test("switches to history and back via the rail", async ({ page }) => {
  await historyTab(page).click();
  await expect(historyTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#class-workspace-title")).toHaveText("Hồ sơ lớp");

  await editTab(page).click();
  await expect(editTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#class-name")).toBeVisible();
});

test("editing marks the rail with the unsaved-changes dot", async ({ page }) => {
  await expect(page.locator('[role="tab"][aria-label="Sửa lớp"] .bg-amber-400')).toHaveCount(0);
  await page.locator("#class-name").fill("Lớp 6A1 đổi tên");
  await expect(page.locator('[role="tab"][aria-label="Sửa lớp"] .bg-amber-400')).toHaveCount(1);
});

test("cancel mode requires a separate confirmation before calling the API", async ({ page }) => {
  await cancelTab(page).click();
  await expect(cancelTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Hủy lớp" })).toBeVisible();
  await expect(page.getByText("học viên hiện tại")).toBeVisible();

  expect((await state(page)).cancelCount).toBe(0);
  await page.getByRole("button", { name: "Hủy lớp", exact: true }).click();
  expect((await state(page)).cancelCount).toBe(1);
});

test("closing with unsaved changes asks for confirmation and stays on cancel", async ({ page }) => {
  await page.locator("#class-name").fill("Lớp 6A1 đổi tên");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Thay đổi chưa được lưu" }),
  ).toBeVisible();
  expect((await state(page)).open).toBe(true);

  await page.getByRole("button", { name: "Ở lại" }).click();
  expect((await state(page)).open).toBe(true);
});

test("discarding unsaved changes closes the workspace", async ({ page }) => {
  await page.locator("#class-name").fill("Lớp 6A1 đổi tên");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Rời khỏi" }).click();
  expect((await state(page)).open).toBe(false);
});
